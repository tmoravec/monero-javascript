const GenUtils = require("./GenUtils");
const MoneroError = require("./MoneroError");
const MoneroRpcConnection = require("./MoneroRpcConnection");
const TaskLooper = require("./TaskLooper");
const ThreadPool = require("./ThreadPool");

/**
 * Manages a collection of prioritized Monero RPC connections.
 */
class MoneroConnectionManager {
  
  constructor() {
    this._timeoutInMs = MoneroConnectionManager.DEFAULT_TIMEOUT;
    this._connections = [];
    this._listeners = [];
  }
  
  /**
   * Add a listener to receive notifications when the connection changes.
   * 
   * @param {MoneroConnectionManagerListener} listener - the listener to add
   * @return {MoneroConnectionManager} this connection manager for chaining
   */
  addListener(listener) {
    this._listeners.push(listener);
    return this;
  }
  
  /**
   * Remove a listener.
   * 
   * @param {MoneroConnectionManagerListener} listener - the listener to remove
   * @return {MoneroConnectionManager} this connection manager for chaining
   */
  removeListener(listener) {
    if (!GenUtils.remove(this._listeners, listener)) throw new MoneroError("Monero connection manager does not contain listener to remove");
    return this;
  }
  
  /**
   * Add a connection. The connection may have an elevated priority for this manager to use.
   * 
   * @param {MoneroRpcConnection} connection - the connection to add
   * @return {MoneroConnectionManager} this connection manager for chaining
   */
  addConnection(connection) {
    for (let aConnection of this._connections) {
      if (aConnection.getUri() === connection.getUri()) throw new MoneroError("Connection URI already exists");
    }
    this._connections.push(connection);
    return this;
  }
  
  /**
   * Remove a connection.
   * 
   * @param {string} uri - of the the connection to remove
   * @return {MoneroConnectionManager} this connection manager for chaining
   */
  removeConnection(uri) {
    let connection = this.getConnectionByUri(uri);
    if (!connection) throw new MoneroError("No connection exists with URI: " + uri);
    GenUtils.remove(connections, connection);
    if (connection === this._currentConnection) this._currentConnection = undefined;
    return this;
  }
  
  /**
   * Indicates if the connection manager is connected to a node.
   * 
   * @return {boolean} true if the current connection is set, online, and not unauthenticated. false otherwise
   */
  isConnected() {
    return this._currentConnection && this._currentConnection.isOnline() && this._currentConnection.isAuthenticated() !== false;
  }
  
  /**
   * Get the current connection.
   * 
   * @return {MoneroRpcConnection} the current connection or undefined if no connection set
   */
  getConnection() {
    return this._currentConnection;
  }
  
  /**
   * Get a connection by URI.
   * 
   * @param {string} uri is the URI of the connection to get
   * @return {MoneroRpcConnection} the connection with the URI or undefined if no connection with the URI exists
   */
  getConnectionByUri(uri) {
    for (let connection of this._connections) if (connection.getUri() === uri) return connection;
    return undefined;
  }
  
  /**
   * Get all connections in order of current connection (if applicable), online status, priority, and name.
   * 
   * @return {MoneroRpcConnection[]} the list of sorted connections
   */
  getConnections() {
    let sortedConnections = GenUtils.copyArray(this._connections);
    sortedConnections.sort(this._compareConnections.bind(this));
    return sortedConnections;
  }
  
  /**
   * Get the best available connection in order of priority then response time.
   * 
   * @param {MoneroRpcConnection[]} excludedConnections - connections to be excluded from consideration (optional)
   * @return {Promise<MoneroRpcConnection>} the best available connection in order of priority then response time, undefined if no connections available
   */
  async getBestAvailableConnection(excludedConnections) {
    
    // try connections within each ascending priority
    for (let prioritizedConnections of this._getConnectionsInAscendingPriority()) {
      try {
      
        // check connections in parallel
        let that = this;
        let checkPromises = [];
        let pool = new ThreadPool(prioritizedConnections.length);
        for (let connection of prioritizedConnections) {
          if (excludedConnections && GenUtils.arrayContains(excludedConnections, connection)) continue;
          checkPromises.push(pool.submit(async function() {
            return new Promise(function(resolve, reject) {
              connection.checkConnection(that._timeoutInMs).then(function() {
                if (connection.isOnline() && connection.isAuthenticated() !== false) resolve(connection);
                else reject();
              }, function(err) {
                reject(err);
              })
            });
          }));
        }
        
        // use first available connection
        let firstAvailable = await Promise.any(checkPromises);
        if (firstAvailable) return firstAvailable;
      } catch (err) {
        if (!(err instanceof AggregateError)) throw new MoneroError(err);
      }
    }
    return undefined;
  }
  
  /**
   * Set the current connection.
   * Provide a URI to select an existing connection without updating its credentials.
   * Provide a MoneroRpcConnection to add new connection or update credentials of existing connection with same URI.
   * Notify if current connection changes.
   * Does not check the connection.
   * 
   * @param {string|MoneroRpcConnection} uriOrConnection - is the uri of the connection or the connection to make current (default undefined for no current connection)
   * @return {MoneroConnectionManager} this connection manager for chaining
   */
  setConnection(uriOrConnection) {
    
    // handle uri
    if (typeof uriOrConnection === "string") {
      let connection = this.getConnectionByUri(uriOrConnection);
      return this.setConnection(connection === undefined ? new MoneroRpcConnection(uriOrConnection) : connection);
    }
    
    // handle connection
    let connection = uriOrConnection;
    if (this._currentConnection === connection) return this;
    
    // check if setting undefined connection
    if (!connection) {
      this._currentConnection = undefined;
      this._onConnectionChanged(undefined);
      return this;
    }
    
    // validate connection type
    if (!(connection instanceof MoneroRpcConnection)) throw new MoneroError("Must provide string or MoneroRpcConnection to set connection");
    
    // check if adding new connection
    let prevConnection = this.getConnectionByUri(connection.getUri());
    if (!prevConnection) {
      this.addConnection(connection);
      this._currentConnection = connection;
      this._onConnectionChanged(this._currentConnection);
      return this;
    }
    
    // check if updating current connection
    if (prevConnection !== this._currentConnection || prevConnection.getUsername() !== connection.getUsername() || connection.getPassword() !== connection.getPassword()) {
      prevConnection.setCredentials(connection.getUsername(), connection.getPassword());
      this._currentConnection = prevConnection;
      this._onConnectionChanged(this._currentConnection);
    }
    
    return this;
  }
  
  /**
   * Check the current connection. If disconnected and auto switch enabled, switches to best available connection.
   * 
   * @return {Promise<MoneroConnectionManager>} this connection manager for chaining
   */
  async checkConnection() {
    let connection = this.getConnection();
    if (connection && await connection.checkConnection(this._timeoutInMs)) await this._onConnectionChanged(connection);   
    if (this._autoSwitch && (!connection || !connection.isOnline() || connection.isAuthenticated() === false)) {
      let bestConnection = await this.getBestAvailableConnection([connection]);
      if (bestConnection) this.setConnection(bestConnection);
    }
    return this;
  }
  
  /**
   * Check all managed connections.
   * 
   * @return {Promise<MoneroConnectionManager>} this connection manager for chaining
   */
  async checkConnections() {
    await Promise.all(this.checkConnectionPromises());
    return this;
  }
  
  /**
   * Check all managed connections, returning a promise for each connection check.
   *
   * @return {Promise[]} a promise for each connection in the order of getConnections().
   */
  checkConnectionPromises() {
    let that = this;
    let checkPromises = [];
    let pool = new ThreadPool(this._connections.length);
    for (let connection of this.getConnections()) {
      checkPromises.push(pool.submit(async function() {
        try {
          if (await connection.checkConnection(that._timeoutInMs) && connection === this._currentConnection) await that._onConnectionChanged(connection);
        } catch (err) {
          // ignore error
        }
      }));
    }
    return checkPromises;
  }
  
  /**
   * Check the connection and start checking the connection periodically.
   * 
   * @param {number} periodMs is the time between checks in milliseconds (default 10000 or 10 seconds)
   * @return {Promise<MoneroConnectionManager>} this connection manager for chaining (after first checking the connection)
   */
  async startCheckingConnection(periodMs) {
    await this.checkConnection();
    if (!periodMs) periodMs = MoneroConnectionManager.DEFAULT_CHECK_CONNECTION_PERIOD;
    if (this._checkLooper) return this;
    let that = this;
    let firstCheck = true;
    this._checkLooper = new TaskLooper(async function() {
      if (firstCheck) {
        firstCheck = false; // skip first check
        return;
      }
      try { await that.checkConnection(); }
      catch (err) { console.error("Error checking connection: " + err); }
    });
    this._checkLooper.start(periodMs);
    return this;
  }
  
  /**
   * Stop periodically checking the connection.
   * 
   * @return {MoneroConnectionManager} this connection manager for chaining
   */
  stopCheckingConnection() {
    if (this._checkLooper) this._checkLooper.stop();
    delete this._checkLooper;
    return this;
  }

  /**
   * Automatically switch to best available connection if current connection is disconnected after being checked.
   * 
   * @param {boolean} autoSwitch specifies if the connection should switch on disconnect
   * @return {MoneroConnectionManager} this connection manager for chaining
   */
  setAutoSwitch(autoSwitch) {
    this._autoSwitch = autoSwitch;
    return this;
  }
  
  /**
   * Set the maximum request time before its connection is considered offline.
   * 
   * @param {int} timeoutInMs - the timeout before the connection is considered offline
   * @return {MoneroConnectionManager} this connection manager for chaining
   */
  setTimeout(timeoutInMs) {
    this._timeoutInMs = timeoutInMs;
    return this;
  }
  
  /**
   * Get the request timeout.
   * 
   * @return {int} the request timeout before a connection is considered offline
   */
  getTimeout() {
    return this._timeoutInMs;
  }
  
  /**
   * Disconnect from the current connection.
   */
  disconnect() {
    this.setConnection(undefined);
  }
  
  /**
   * Collect connectable peers of the managed connections.
   *
   * @return {MoneroRpcConnection[]} connectable peers
   */
  async getPeerConnections() {
    throw new MoneroError("Not implemented");
  }
  
  // ------------------------------ PRIVATE HELPERS ---------------------------
  
  async _onConnectionChanged(connection) {
    let promises = [];
    for (let listener of this._listeners) promises.push(listener.onConnectionChanged(connection));
    return Promise.all(promises);
  }
  
  _getConnectionsInAscendingPriority() {
    let connectionPriorities = new Map();
    for (let connection of this._connections) {
      if (!connectionPriorities.has(connection.getPriority())) connectionPriorities.set(connection.getPriority(), []);
      connectionPriorities.get(connection.getPriority()).push(connection);
    }
    let ascendingPriorities = new Map([...connectionPriorities].sort((a, b) => parseInt(a[0]) - parseInt(b[0]))); // create map in ascending order
    let ascendingPrioritiesList = [];
    for (let priorityConnections of ascendingPriorities.values()) ascendingPrioritiesList.push(priorityConnections);
    if (connectionPriorities.has(0)) ascendingPrioritiesList.push(ascendingPrioritiesList.splice(0, 1)); // move priority 0 to end
    return ascendingPrioritiesList;
  }
  
  _compareConnections(c1, c2) {
    
      // current connection is first
      if (c1 === this._currentConnection) return -1;
      if (c2 === this._currentConnection) return 1;
      
      // order by availability then priority then by name
      if (c1.isOnline() === c2.isOnline()) {
        if (c1.getPriority() === c2.getPriority()) return c1.getUri().localeCompare(c2.getUri());
        else return c1.getPriority() == 0 ? 1 : c2.getPriority() == 0 ? -1 : c1.getPriority() - c2.getPriority();
      } else {
        if (c1.isOnline()) return -1;
        else if (c2.isOnline()) return 1;
        else if (c1.isOnline() === undefined) return -1;
        else return 1; // c1 is offline
      }
  }
}

MoneroConnectionManager.DEFAULT_TIMEOUT = 5000;
MoneroConnectionManager.DEFAULT_CHECK_CONNECTION_PERIOD = 10000;

module.exports = MoneroConnectionManager;