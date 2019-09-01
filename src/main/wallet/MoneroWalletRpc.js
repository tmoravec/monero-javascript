/**
 * Copyright (c) 2017-2019 woodser
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const assert = require("assert");
const Filter = require("../utils/Filter");
const BigInteger = require("../../../external/mymonero-core-js/cryptonote_utils/biginteger").BigInteger;
const GenUtils = require("../utils/GenUtils");
const MoneroUtils = require("../utils/MoneroUtils");
const MoneroError = require("../utils/MoneroError");
const MoneroRpcConnection = require("../rpc/MoneroRpcConnection");
const MoneroBlock = require("../daemon/model/MoneroBlock");
const MoneroBlockHeader = require("../daemon/model/MoneroBlockHeader");
const MoneroWallet = require("./MoneroWallet");
const MoneroSyncResult = require('./model/MoneroSyncResult');
const MoneroIntegratedAddress = require("./model/MoneroIntegratedAddress");
const MoneroAccount = require("./model/MoneroAccount");
const MoneroSubaddress = require("./model/MoneroSubaddress");
const MoneroTxWallet = require("./model/MoneroTxWallet");
const MoneroTxSet = require("./model/MoneroTxSet");
const MoneroTransfer = require("./model/MoneroTransfer");
const MoneroIncomingTransfer = require("./model/MoneroIncomingTransfer");
const MoneroOutgoingTransfer = require("./model/MoneroOutgoingTransfer");
const MoneroDestination = require("./model/MoneroDestination");
const MoneroOutputWallet = require("./model/MoneroOutputWallet");
const MoneroSendRequest = require("./model/MoneroSendRequest");
const MoneroCheckTx = require("./model/MoneroCheckTx");
const MoneroCheckReserve = require("./model/MoneroCheckReserve");
const MoneroTxQuery = require("./model/MoneroQueries").MoneroTxQuery;
const MoneroTransferQuery = require("./model/MoneroQueries").MoneroTransferQuery;
const MoneroOutputQuery = require("./model/MoneroQueries").MoneroOutputQuery;
const MoneroAccountTag = require("./model/MoneroAccountTag");
const MoneroAddressBookEntry = require("./model/MoneroAddressBookEntry");
const MoneroKeyImage = require("../daemon/model/MoneroKeyImage");
const MoneroKeyImageImportResult = require("./model/MoneroKeyImageImportResult");
const MoneroMultisigInfo = require("./model/MoneroMultisigInfo");
const MoneroMultisigInitResult = require("./model/MoneroMultisigInitResult");
const MoneroMultisigSignResult = require("./model/MoneroMultisigSignResult");

/**
 * Implements a Monero wallet using monero-wallet-rpc.
 */
class MoneroWalletRpc extends MoneroWallet {
  
  /**
   * Constructs the wallet rpc instance.
   * 
   * @param {object} config defines the rpc configuration
   * @param {string} config.uri is the uri of the rpc endpoint
   * @param {string} config.protocol is the protocol of the rpc endpoint
   * @param {string} config.host is the host of the rpc endpoint
   * @param {int}    config.port is the port of the rpc endpoint
   * @param {string} config.user is a username to authenticate with the rpc endpoint
   * @param {string} config.password is a password to authenticate with the rpc endpoint
   * @param {string} config.maxRequestsPerSecond is the maximum requests per second to allow
   */
  constructor(config) {
    super();
    
    // normalize config
    if (typeof config === "string") this.config = {uri: config}
    this.config = Object.assign({}, config);
    
    // initialize rpc instance if not given
    if (!this.config.rpc) this.config.rpc = new MoneroRpcConnection(config);
    
    // initialize address cache to avoid unecessary requests for addresses
    this.addressCache = {};
  }
  
  // --------------------------- RPC WALLET METHODS ---------------------------
  
  /**
   * Get the wallet's RPC connection.
   * 
   * @return {MoneroWalletRpcthe wallet's rpc connection
   */
  getRpcConnection() {
    return this.config.rpc;
  }
  
  /**
   * Open an existing wallet on the RPC server.
   * 
   * @param {string} name is the name of the wallet file to open
   * @param {string} password is the password to decrypt the wallet file
   */
  async openWallet(name, password) {
    if (!name) throw new MoneroError("Filename is not initialized");
    if (!password) throw new MoneroError("Password is not initialized");
    await this.config.rpc.sendJsonRequest("open_wallet", {filename: name, password: password});
    delete this.addressCache;
    this.addressCache = {};
    this.path = name;
  }
  
  /**
   * Create and open a new wallet with a randomly generated seed on the RPC server.
   * 
   * @param {string} name is the name of the wallet file to create
   * @param {string} password is the wallet's password
   * @param {string} language is the language for the wallet's mnemonic seed
   */
  async createWalletRandom(name, password, language) {
    if (!name) throw new MoneroError("Name is not initialized");
    if (!password) throw new MoneroError("Password is not initialized");
    if (!language) language = MoneroWallet.DEFAULT_LANGUAGE;
    let params = { filename: name, password: password, language: language };
    await this.config.rpc.sendJsonRequest("create_wallet", params);
    this.addressCache = {};
    this.path = name;
  }
  
  /**
   * Create and open a wallet from an existing mnemonic phrase on the RPC server,
   * closing the currently open wallet if applicable.
   * 
   * @param {string} name is the name of the wallet to create on the RPC server
   * @param {string} password is the wallet's password
   * @param {string} mnemonic is the mnemonic of the wallet to construct
   * @param {int} restoreHeight is the block height to restore from (default = 0)
   * @param {string} language is the language of the mnemonic in case the old language is invalid
   * @param {int} offset is the offset for restoring from mnemonic
   * @param {boolean} saveCurrent specifies if the current RPC wallet should be saved before being closed
   */
  async createWalletFromMnemonic(name, password, mnemonic, restoreHeight, language, offset, saveCurrent) {
    await this.config.rpc.sendJsonRequest("restore_deterministic_wallet", {
      filename: name,
      password: password,
      seed: mnemonic,
      seed_offset: offset,
      restore_height: restoreHeight,
      language: language,
      autosave_current: saveCurrent
    })
    this.path = name;
  }
  
  /**
   * Save and close the current wallet and stop the RPC server.
   */
  async stop() {
    delete this.addressCache;
    this.addressCache = {};
    this.path = undefined;
    await this.config.rpc.sendJsonRequest("stop_wallet");
  }
  
  // -------------------------- COMMON WALLET METHODS -------------------------
  
  async getPath() {
    return this.path;
  }
  
  async getSeed() {
    throw new MoneroError("monero-wallet-rpc does not support getting the wallet seed");
  }

  async getMnemonic() {
    let resp = await this.config.rpc.sendJsonRequest("query_key", { key_type: "mnemonic" });
    return resp.result.key;
  }

  async getLanguages() {
    return (await this.config.rpc.sendJsonRequest("get_languages")).result.languages;
  }
  
  async getPrivateViewKey() {
    let resp = await this.config.rpc.sendJsonRequest("query_key", { key_type: "view_key" });
    return resp.result.key;
  }
  
  async getPrivateSpendKey() {
    let resp = await this.config.rpc.sendJsonRequest("query_key", { key_type: "spend_key" });
    return resp.result.key;
  }
  
  async getAddress(accountIdx, subaddressIdx) {
    let subaddressMap = this.addressCache[accountIdx];
    if (!subaddressMap) {
      await this.getSubaddresses(accountIdx, undefined, true);  // cache's all addresses at this account
      return this.getAddress(accountIdx, subaddressIdx);        // recursive call uses cache
    }
    let address = subaddressMap[subaddressIdx];
    if (!address) {
      await this.getSubaddresses(accountIdx, undefined, true);  // cache's all addresses at this account
      return this.addressCache[accountIdx][subaddressIdx];
    }
    return address;
  }
  
  // TODO: use cache
  async getAddressIndex(address) {
    
    // fetch result and normalize error if address does not belong to the wallet
    let resp;
    try {
      resp = await this.config.rpc.sendJsonRequest("get_address_index", {address: address});
    } catch (e) {
      if (e.getCode() === -2) throw new MoneroError(e.message);
      throw e;
    }
    
    // convert rpc response
    let subaddress = new MoneroSubaddress(address);
    subaddress.setAccountIndex(resp.result.index.major);
    subaddress.setIndex(resp.result.index.minor);
    return subaddress;
  }
  
  async getIntegratedAddress(paymentId) {
    try {
      let integratedAddressStr = (await this.config.rpc.sendJsonRequest("make_integrated_address", {payment_id: paymentId})).result.integrated_address;
      return await this.decodeIntegratedAddress(integratedAddressStr);
    } catch (e) {
      if (e.message.includes("Invalid payment ID")) throw new MoneroError("Invalid payment ID: " + paymentId);
      throw e;
    }
  }
  
  async decodeIntegratedAddress(integratedAddress) {
    let resp = await this.config.rpc.sendJsonRequest("split_integrated_address", {integrated_address: integratedAddress});
    return new MoneroIntegratedAddress(resp.result.standard_address, resp.result.payment_id, integratedAddress);
  }
  
  async getHeight() {
    return (await this.config.rpc.sendJsonRequest("get_height")).result.height;
  }
  
  async getDaemonHeight() {
    throw new MoneroError("monero-wallet-rpc does not support getting the chain height");
  }
  
  async sync(startHeight, onProgress) {
    assert(onProgress === undefined, "Monero Wallet RPC does not support reporting sync progress");
    let resp = await this.config.rpc.sendJsonRequest("refresh", {start_height: startHeight});
    return new MoneroSyncResult(resp.result.blocks_fetched, resp.result.received_money);
  }
  
  async startSyncing() {
    // nothing to do because wallet rpc syncs automatically
  }
  
  async rescanSpent() {
    await this.config.rpc.sendJsonRequest("rescan_spent");
  }
  
  async rescanBlockchain() {
    await this.config.rpc.sendJsonRequest("rescan_blockchain");
  }
  
  async getBalance(accountIdx, subaddressIdx) {
    return (await this._getBalances(accountIdx, subaddressIdx))[0];
  }
  
  async getUnlockedBalance(accountIdx, subaddressIdx) {
    return (await this._getBalances(accountIdx, subaddressIdx))[1];
  }
  
  async getAccounts(includeSubaddresses, tag, skipBalances) {
    
    // fetch accounts from rpc
    let resp = await this.config.rpc.sendJsonRequest("get_accounts", {tag: tag});
    
    // build account objects and fetch subaddresses per account using get_address
    // TODO monero-wallet-rpc: get_address should support all_accounts so not called once per account
    let accounts = [];
    for (let rpcAccount of resp.result.subaddress_accounts) {
      let account = MoneroWalletRpc._convertRpcAccount(rpcAccount);
      if (includeSubaddresses) account.setSubaddresses(await this.getSubaddresses(account.getIndex(), undefined, true));
      accounts.push(account);
    }
    
    // fetch and merge fields from get_balance across all accounts
    if (includeSubaddresses && !skipBalances) {
      
      // these fields are not initialized if subaddress is unused and therefore not returned from `get_balance`
      for (let account of accounts) {
        for (let subaddress of account.getSubaddresses()) {
          subaddress.setBalance(new BigInteger(0));
          subaddress.setUnlockedBalance(new BigInteger(0));
          subaddress.setNumUnspentOutputs(0);
          subaddress.setNumBlocksToUnlock(0);
        }
      }
      
      // fetch and merge info from get_balance
      resp = await this.config.rpc.sendJsonRequest("get_balance", {all_accounts: true});
      if (resp.result.per_subaddress) {
        for (let rpcSubaddress of resp.result.per_subaddress) {
          let subaddress = MoneroWalletRpc._convertRpcSubaddress(rpcSubaddress);
          
          // merge info
          let account = accounts[subaddress.getAccountIndex()];
          assert.equal(subaddress.getAccountIndex(), account.getIndex(), "RPC accounts are out of order");  // would need to switch lookup to loop
          let tgtSubaddress = account.getSubaddresses()[subaddress.getIndex()];
          assert.equal(subaddress.getIndex(), tgtSubaddress.getIndex(), "RPC subaddresses are out of order");
          if (subaddress.getBalance() !== undefined) tgtSubaddress.setBalance(subaddress.getBalance());
          if (subaddress.getUnlockedBalance() !== undefined) tgtSubaddress.setUnlockedBalance(subaddress.getUnlockedBalance());
          if (subaddress.getNumUnspentOutputs() !== undefined) tgtSubaddress.setNumUnspentOutputs(subaddress.getNumUnspentOutputs());
        }
      }
    }
    
    // return accounts
    return accounts;
  }
  
  // TODO: getAccountByIndex(), getAccountByTag()
  async getAccount(accountIdx, includeSubaddresses, skipBalances) {
    assert(accountIdx >= 0);
    for (let account of await this.getAccounts()) {
      if (account.getIndex() === accountIdx) {
        if (includeSubaddresses) account.setSubaddresses(await this.getSubaddresses(accountIdx, undefined, skipBalances));
        return account;
      }
    }
    throw new Exception("Account with index " + accountIdx + " does not exist");
  }

  async createAccount(label) {
    label = label ? label : undefined;
    let resp = await this.config.rpc.sendJsonRequest("create_account", {label: label});
    return new MoneroAccount(resp.result.account_index, resp.result.address, new BigInteger(0), new BigInteger(0));
  }

  async getSubaddresses(accountIdx, subaddressIndices, skipBalances) {
    
    // fetch subaddresses
    let params = {};
    params.account_index = accountIdx;
    if (subaddressIndices) params.address_index = GenUtils.listify(subaddressIndices);
    let resp = await this.config.rpc.sendJsonRequest("get_address", params);
    
    // initialize subaddresses
    let subaddresses = [];
    for (let rpcSubaddress of resp.result.addresses) {
      let subaddress = MoneroWalletRpc._convertRpcSubaddress(rpcSubaddress);
      subaddress.setAccountIndex(accountIdx);
      subaddresses.push(subaddress);
    }
    
    // fetch and initialize subaddress balances
    if (!skipBalances) {
      
      // these fields are not initialized if subaddress is unused and therefore not returned from `get_balance`
      for (let subaddress of subaddresses) {
        subaddress.setBalance(new BigInteger(0));
        subaddress.setUnlockedBalance(new BigInteger(0));
        subaddress.setNumUnspentOutputs(0);
        subaddress.setNumBlocksToUnlock(0);
      }

      // fetch and initialize balances
      resp = await this.config.rpc.sendJsonRequest("get_balance", params);
      if (resp.result.per_subaddress) {
        for (let rpcSubaddress of resp.result.per_subaddress) {
          let subaddress = MoneroWalletRpc._convertRpcSubaddress(rpcSubaddress);
          
          // transfer info to existing subaddress object
          for (let tgtSubaddress of subaddresses) {
            if (tgtSubaddress.getIndex() !== subaddress.getIndex()) continue; // skip to subaddress with same index
            if (subaddress.getBalance() !== undefined) tgtSubaddress.setBalance(subaddress.getBalance());
            if (subaddress.getUnlockedBalance() !== undefined) tgtSubaddress.setUnlockedBalance(subaddress.getUnlockedBalance());
            if (subaddress.getNumUnspentOutputs() !== undefined) tgtSubaddress.setNumUnspentOutputs(subaddress.getNumUnspentOutputs());
            if (subaddress.getNumBlocksToUnlock() !== undefined) tgtSubaddress.setNumBlocksToUnlock(subaddress.getNumBlocksToUnlock());
          }
        }
      }
    }
    
    // cache addresses
    let subaddressMap = this.addressCache[accountIdx];
    if (!subaddressMap) {
      subaddressMap = {};
      this.addressCache[accountIdx] = subaddressMap;
    }
    for (let subaddress of subaddresses) {
      subaddressMap[subaddress.getIndex()] = subaddress.getAddress();
    }
    
    // return results
    return subaddresses;
  }

  async getSubaddress(accountIdx, subaddressIdx, skipBalances) {
    assert(accountIdx >= 0);
    assert(subaddressIdx >= 0);
    return (await this.getSubaddresses(accountIdx, subaddressIdx, skipBalances))[0];
  }

  async createSubaddress(accountIdx, label) {
    
    // send request
    let resp = await this.config.rpc.sendJsonRequest("create_address", {account_index: accountIdx, label: label});
    
    // build subaddress object
    let subaddress = new MoneroSubaddress();
    subaddress.setAccountIndex(accountIdx);
    subaddress.setIndex(resp.result.address_index);
    subaddress.setAddress(resp.result.address);
    subaddress.setLabel(label ? label : undefined);
    subaddress.setBalance(new BigInteger(0));
    subaddress.setUnlockedBalance(new BigInteger(0));
    subaddress.setNumUnspentOutputs(0);
    subaddress.setIsUsed(false);
    subaddress.setNumBlocksToUnlock(0);
    return subaddress;
  }
  
  async getTxs(query) {
    
    // normalize tx query
    if (query instanceof MoneroTxQuery) query = query.copy();
    else if (Array.isArray(query)) query = new MoneroTxQuery().setTxIds(query);
    else {
      query = Object.assign({}, query);
      query = new MoneroTxQuery(query);
    }
    if (query.getTransferQuery() === undefined) query.setTransferQuery(new MoneroTransferQuery());
    let transferQuery = query.getTransferQuery();
    
    // temporarily disable transfer query
    query.setTransferQuery(undefined);
    
    // fetch all transfers that meet tx query
    let transfers = await this.getTransfers(new MoneroTransferQuery().setTxQuery(query));
    
    // collect unique txs from transfers while retaining order
    let txs = [];
    let txsSet = new Set();
    for (let transfer of transfers) {
      if (!txsSet.has(transfer.getTx())) {
        txs.push(transfer.getTx());
        txsSet.add(transfer.getTx());
      }
    }
    
    // cache types into maps for merging and lookup
    let txMap = new Map();
    let blockMap = new Map();
    for (let tx of txs) {
      MoneroWalletRpc._mergeTx(tx, txMap, blockMap, false);
    }
    
    // fetch and merge outputs if requested
    if (query.getIncludeOutputs()) {
      let outputs = await this.getOutputs(new MoneroOutputQuery().setTxQuery(query));
      
      // merge output txs one time while retaining order
      let outputTxs = [];
      for (let output of outputs) {
        if (!outputTxs.includes(output.getTx())){
          MoneroWalletRpc._mergeTx(output.getTx(), txMap, blockMap, true);
          outputTxs.push(output.getTx());
        }
      }
    }
    
    // filter txs that don't meet transfer query
    query.setTransferQuery(transferQuery);
    let txsQueried = [];
    for (let tx of txs) {
      if (query.meetsCriteria(tx)) txsQueried.push(tx);
      else if (tx.getBlock() !== undefined) tx.getBlock().getTxs().splice(tx.getBlock().getTxs().indexOf(tx), 1);
    }
    txs = txsQueried;
    
    // verify all specified tx ids found
    if (query.getTxIds()) {
      for (let txId of query.getTxIds()) {
        let found = false;
        for (let tx of txs) {
          if (txId === tx.getId()) {
            found = true;
            break;
          }
        }
        if (!found) throw new MoneroError("Tx not found in wallet: " + txId);
      }
    }
    
    // special case: re-fetch txs if inconsistency caused by needing to make multiple rpc calls
    for (let tx of txs) {
      if (tx.isConfirmed() && tx.getBlock() === undefined) return this.getTxs(query);
    }
    
    // order txs if tx ids given then return
    if (query.getTxIds() && query.getTxIds().length > 0) {
      let txsById = new Map()  // store txs in temporary map for sorting
      for (let tx of txs) txsById.set(tx.getId(), tx);
      let orderedTxs = [];
      for (let txId of query.getTxIds()) if (txsById.get(txId)) orderedTxs.push(txsById.get(txId));
      txs = orderedTxs;
    }
    return txs;
  }
  
  async getTransfers(query) {
    
    // copy and normalize query up to block
    if (query === undefined) query = new MoneroTransferQuery();
    else if (query instanceof MoneroTransferQuery) {
      if (query.getTxQuery() === undefined) query = query.copy();
      else {
        let txQuery = query.getTxQuery().copy();
        if (query.getTxQuery().getTransferQuery() === query) query = txQuery.getTransferQuery();
        else {
          assert.equal(query.getTxQuery().getTransferQuery(), undefined, "Transfer query's tx query must be circular reference or null");
          query = query.copy();
          query.setTxQuery(txQuery);
        }
      }
    } else {
      query = Object.assign({}, query);
      query = new MoneroTransferQuery(query).setTxQuery(new MoneroTxQuery(query));
    }
    if (query.getTxQuery() === undefined) query.setTxQuery(new MoneroTxQuery());
    let txQuery = query.getTxQuery();
    txQuery.setTransferQuery(undefined); // break circular link for meetsCriteria()
    
    // build params for get_transfers rpc call
    let params = {};
    let canBeConfirmed = txQuery.isConfirmed() !== false && txQuery.inTxPool() !== true && txQuery.isFailed() !== true && txQuery.isRelayed() !== false;
    let canBeInTxPool = txQuery.isConfirmed() !== true && txQuery.inTxPool() !== false && txQuery.isFailed() !== true && txQuery.isRelayed() !== false && txQuery.getHeight() === undefined && txQuery.getMinHeight() === undefined && txQuery.getMaxHeight() === undefined;
    let canBeIncoming = query.isIncoming() !== false && query.isOutgoing() !== true && query.hasDestinations() !== true;
    let canBeOutgoing = query.isOutgoing() !== false && query.isIncoming() !== true;
    params.in = canBeIncoming && canBeConfirmed;
    params.out = canBeOutgoing && canBeConfirmed;
    params.pool = canBeIncoming && canBeInTxPool;
    params.pending = canBeOutgoing && canBeInTxPool;
    params.failed = txQuery.isFailed() !== false && txQuery.isConfirmed() !== true && txQuery.inTxPool() != true;
    if (txQuery.getMinHeight() !== undefined) {
      if (txQuery.getMinHeight() > 0) params.min_height = txQuery.getMinHeight() - 1; // TODO monero core: wallet2::get_payments() min_height is exclusive, so manually offset to match intended range (issues #5751, #5598)
      else params.min_height = txQuery.getMinHeight();
    }
    if (txQuery.getMaxHeight() !== undefined) params.max_height = txQuery.getMaxHeight();
    params.filter_by_height = txQuery.getMinHeight() !== undefined || txQuery.getMaxHeight() !== undefined;
    if (query.getAccountIndex() === undefined) {
      assert(query.getSubaddressIndex() === undefined && query.getSubaddressIndices() === undefined, "Filter specifies a subaddress index but not an account index");
      params.all_accounts = true;
    } else {
      params.account_index = query.getAccountIndex();
      
      // set subaddress indices param
      let subaddressIndices = new Set();
      if (query.getSubaddressIndex() !== undefined) subaddressIndices.add(query.getSubaddressIndex());
      if (query.getSubaddressIndices() !== undefined) query.getSubaddressIndices().map(subaddressIdx => subaddressIndices.add(subaddressIdx));
      if (subaddressIndices.size) params.subaddr_indices = Array.from(subaddressIndices);
    }
    
    // cache unique txs and blocks
    let txMap = {};
    let blockMap = {};
    
    // build txs using `get_transfers`
    let resp = await this.config.rpc.sendJsonRequest("get_transfers", params);
    for (let key of Object.keys(resp.result)) {
      for (let rpcTx of resp.result[key]) {
        //if (rpcTx.txid === query.debugTxId) console.log(rpcTx);
        let tx = MoneroWalletRpc._convertRpcTxWithTransfer(rpcTx);
        if (tx.isConfirmed()) assert(tx.getBlock().getTxs().indexOf(tx) > -1);
        
        // replace transfer amount with destination sum
        // TODO monero-wallet-rpc: confirmed tx from/to same account has amount 0 but cached transfers
        if (tx.getOutgoingTransfer() !== undefined && tx.isRelayed() && !tx.isFailed() &&
            tx.getOutgoingTransfer().getDestinations() && tx.getOutgoingAmount().compare(new BigInteger(0)) === 0) {
          let outgoingTransfer = tx.getOutgoingTransfer();
          let transferTotal = new BigInteger(0);
          for (let destination of outgoingTransfer.getDestinations()) transferTotal = transferTotal.add(destination.getAmount());
          tx.getOutgoingTransfer().setAmount(transferTotal);
        }
        
        // merge tx
        MoneroWalletRpc._mergeTx(tx, txMap, blockMap, false);
      }
    }
    
    // sort txs by block height
    let txs = Object.values(txMap);
    txs.sort(MoneroWalletRpc._compareTxsByHeight);
    
    // filter and return transfers
    let transfers = [];
    for (let tx of txs) {
      
      // sort transfers
      if (tx.getIncomingTransfers() !== undefined) tx.getIncomingTransfers().sort(MoneroWalletRpc._compareIncomingTransfers);
      
      // collect outgoing transfer, erase if filtered
      if (tx.getOutgoingTransfer() !== undefined && query.meetsCriteria(tx.getOutgoingTransfer())) transfers.push(tx.getOutgoingTransfer());
      else tx.setOutgoingTransfer(undefined);
      
      // collect incoming transfers, erase if filtered
      if (tx.getIncomingTransfers() !== undefined) {
        let toRemoves = [];
        for (let transfer of tx.getIncomingTransfers()) {
          if (query.meetsCriteria(transfer)) transfers.push(transfer);
          else toRemoves.push(transfer);
        }
        
        // remove excluded transfers
        tx.setIncomingTransfers(tx.getIncomingTransfers().filter(function(transfer) {
          return !toRemoves.includes(transfer);
        }));
        if (tx.getIncomingTransfers().length === 0) tx.setIncomingTransfers(undefined);
      }
      
      // remove txs without requested transfer
      if (tx.getBlock() !== undefined && tx.getOutgoingTransfer() === undefined && tx.getIncomingTransfers() === undefined) {
        tx.getBlock().getTxs().splice(tx.getBlock().getTxs().indexOf(tx), 1);
      }
      
//      if (tx.getHeight() === 364866) {
//        console.log("HERE IS TX WITH HEIGHT");
//        if (query.meetsCriteria(tx.getOutgoingTransfer())) console.log("Outgoing transfer met!!!");
//        else console.log("Outgoing transfer not met!");
//        assert(query.meetsCriteria(tx.getOutgoingTransfer()));
//      }
//      if (query.meetsCriteria(tx.getOutgoingTransfer())) transfers.push(tx.getOutgoingTransfer());
//      if (tx.getIncomingTransfers()) Filter.apply(query, tx.getIncomingTransfers()).map(transfer => transfers.push(transfer));
    }
    
    return transfers;
  }
  
  async getOutputs(query) {
    
    // copy and normalize query up to block
    if (query === undefined) query = new MoneroOutputQuery();
    else if (query instanceof MoneroOutputQuery) {
      if (query.getTxQuery() === undefined) query = query.copy();
      else {
        let txQuery = query.getTxQuery().copy();
        if (query.getTxQuery().getOutputQuery() === query) query = txQuery.getOutputQuery();
        else {
          assert.equal(query.getTxQuery().getOutputQuery(), undefined, "Output query's tx query must be circular reference or null");
          query = query.copy();
          query.setTxQuery(txQuery);
        }
      }
    } else {
      query = Object.assign({}, query);
      query = new MoneroOutputQuery(query).setTxQuery(new MoneroTxQuery(query));
    }
    if (query.getTxQuery() === undefined) query.setTxQuery(new MoneroTxQuery());
    let txQuery = query.getTxQuery();
    txQuery.setOutputQuery(undefined); // break circular link for meetsCriteria()
    
//    // normalize output request
//    if (request instanceof MoneroOutputRequest) { }
//    else {
//      request = Object.assign({}, request);
//      request = new MoneroOutputRequest(request).setTxRequest(new MoneroTxRequest(request));
//    }
//    if (!request.getTxRequest()) request.setTxRequest(new MoneroTxRequest());
//    
//    // copy and normalize query up to block
//    if (query === undefined) query = new MoneroOutputQuery();
//    else {
//      if (query.getTxQuery() === undefined) query = query.copy();
//      else {
//        let txQuery = query.getTxQuery().copy();
//        if (query.getTxQuery().getOutputQuery() === query) query = txQuery.getOutputQuery();
//        else {
//          assert.equal(query.getTxQuery().getOutputQuery(), undefined, "Transfer request's tx request must be circular reference or null");
//          query = query.copy();
//          query.setTxQuery(txQuery);
//        }
//      }
//    }
//    if (query.getTxQuery() === undefined) query.setTxQuery(new MoneroTxQuery());
//    let txQuery = query.getTxQuery();
//    
//    // copy and normalize query up to block
//    if (query === undefined) query = new MoneroOutputQuery();
//    else {
//      if (query.getTxQuery() === undefined) query = query.copy();
//      else {
//        let txQuery = query.getTxQuery().copy();
//        if (query.getTxQuery().getOutputQuery() === query) query = txQuery.getOutputQuery();
//        else {
//          assert.equal(query.getTxQuery().getOutputQuery(), undefined, "Transfer request's tx request must be circular reference or null");
//          query = query.copy();
//          query.setTxQuery(txQuery);
//        }
//      }
//    }
//    if (query.getTxQuery() === undefined) query.setTxQuery(new MoneroTxQuery());
//    let txQuery = query.getTxQuery();
    
    // determine account and subaddress indices to be queried
    let indices = new Map();
    if (query.getAccountIndex() !== undefined) {
      let subaddressIndices = new Set();
      if (query.getSubaddressIndex() !== undefined) subaddressIndices.add(query.getSubaddressIndex());
      if (query.getSubaddressIndices() !== undefined) query.getSubaddressIndices().map(subaddressIdx => subaddressIndices.add(subaddressIdx));
      indices.set(query.getAccountIndex(), subaddressIndices.size ? Array.from(subaddressIndices) : undefined);  // undefined will fetch from all subaddresses
    } else {
      assert.equal(query.getSubaddressIndex(), undefined, "Filter specifies a subaddress index but not an account index")
      assert(query.getSubaddressIndices() === undefined || query.getSubaddressIndices().length === 0, "Filter specifies subaddress indices but not an account index");
      indices = await this._getAccountIndices();  // fetch all account indices without subaddresses
    }
    
    // cache unique txs and blocks
    let txMap = {};
    let blockMap = {};
    
    // collect txs with vouts for each indicated account using `incoming_transfers` rpc call
    let params = {};
    params.transfer_type = query.isSpent() === true ? "unavailable" : query.isSpent() === false ? "available" : "all";
    params.verbose = true;
    for (let accountIdx of indices.keys()) {
    
      // send request
      params.account_index = accountIdx;
      params.subaddr_indices = indices.get(accountIdx);
      let resp = await this.config.rpc.sendJsonRequest("incoming_transfers", params);
      
      // convert response to txs with vouts and merge
      if (resp.result.transfers === undefined) continue;
      for (let rpcVout of resp.result.transfers) {
        let tx = MoneroWalletRpc._convertRpcTxWalletWithVout(rpcVout);
        MoneroWalletRpc._mergeTx(tx, txMap, blockMap, false);
      }
    }
    
    // sort txs by block height
    let txs = Object.values(txMap);
    txs.sort(MoneroWalletRpc._compareTxsByHeight);
    
    // collect queried vouts
    let vouts = [];
    for (let tx of txs) {
      
      // sort vouts
      if (tx.getVouts() !== undefined) tx.getVouts().sort(MoneroWalletRpc._compareVouts);
      
      // collect queried vouts
      let toRemoves = [];
      for (let vout of tx.getVouts()) {
        if (query.meetsCriteria(vout)) vouts.push(vout);
        else toRemoves.push(vout);
      }
      
      // remove excluded vouts
      tx.setVouts(tx.getVouts().filter(function(vout) { return !toRemoves.includes(vout); }))
      
      // remove excluded txs from block
      if ((tx.getVouts() === undefined || tx.getVouts().length === 0) && tx.getBlock() !== undefined) {
        tx.getBlock().getTxs().splice(tx.getBlock().getTxs().indexOf(tx), 1);
      }
    }
    return vouts;
  }
  
  async getOutputsHex() {
    return (await this.config.rpc.sendJsonRequest("export_outputs")).result.outputs_data_hex;
  }
  
  async importOutputsHex(outputsHex) {
    let resp = await this.config.rpc.sendJsonRequest("import_outputs", {outputs_data_hex: outputsHex});
    return resp.result.num_imported;
  }
  
  async getKeyImages() {
    return await this._rpcExportKeyImages(true);
  }
  
  async importKeyImages(keyImages) {
    
    // convert key images to rpc parameter
    let rpcKeyImages = keyImages.map(keyImage => ({key_image: keyImage.getHex(), signature: keyImage.getSignature()}));
    
    // send request
    let resp = await this.config.rpc.sendJsonRequest("import_key_images", {signed_key_images: rpcKeyImages});
    
    // build and return result
    let importResult = new MoneroKeyImageImportResult();
    importResult.setHeight(resp.result.height);
    importResult.setSpentAmount(new BigInteger(resp.result.spent));
    importResult.setUnspentAmount(new BigInteger(resp.result.unspent));
    return importResult;
  }
  
  async getNewKeyImagesFromLastImport() {
    return await this._rpcExportKeyImages(false);
  }
  
  async relayTxs(txsOrMetadatas) {
    assert(Array.isArray(txsOrMetadatas), "Must provide an array of txs or their metadata to relay");
    let txIds = [];
    for (let txOrMetadata of txsOrMetadatas) {
      let metadata = txOrMetadata instanceof MoneroTxWallet ? txOrMetadata.getMetadata() : txOrMetadata;
      let resp = await this.config.rpc.sendJsonRequest("relay_tx", { hex: metadata });
      txIds.push(resp.result.tx_hash);
    }
    return txIds;
  }

  async sendSplit(requestOrAccountIndex, address, amount, priority) {
    
    // normalize and validate request
    let request;
    if (requestOrAccountIndex instanceof MoneroSendRequest) {
      assert.equal(arguments.length, 1, "Sending requires a send request or parameters but not both");
      request = requestOrAccountIndex;
    } else {
      if (requestOrAccountIndex instanceof Object) request = new MoneroSendRequest(requestOrAccountIndex);
      else request = new MoneroSendRequest(requestOrAccountIndex, address, amount, priority);
    }
    assert.notEqual(request.getDestinations(), undefined, "Must specify destinations");
    if (request.getCanSplit() === undefined) request.setCanSplit(true);
    assert.equal(request.getSweepEachSubaddress(), undefined);
    assert.equal(request.getBelowAmount(), undefined);

    // determine account and subaddresses to send from
    let accountIdx = request.getAccountIndex();
    if (accountIdx === undefined) throw new MoneroError("Must specify the account index to send from");
    let subaddressIndices = request.getSubaddressIndices() === undefined ? undefined : request.getSubaddressIndices().slice(0); // fetch all or copy given indices
    
    // build request parameters
    let params = {};
    params.destinations = [];
    for (let destination of request.getDestinations()) {
      assert(destination.getAddress(), "Destination address is not defined");
      assert(destination.getAmount(), "Destination amount is not defined");
      params.destinations.push({ address: destination.getAddress(), amount: destination.getAmount().toString() });
    }
    params.account_index = accountIdx;
    params.subaddr_indices = subaddressIndices;
    params.payment_id = request.getPaymentId();
    params.mixin = request.getMixin();
    params.ring_size = request.getRingSize();
    params.unlock_time = request.getUnlockTime();
    params.do_not_relay = request.getDoNotRelay();
    assert(request.getPriority() === undefined || request.getPriority() >= 0 && request.getPriority() <= 3);
    params.priority = request.getPriority();
    params.get_tx_key = true;
    params.get_tx_hex = true;
    params.get_tx_metadata = true;
    
    // send request
    let resp = await this.config.rpc.sendJsonRequest(request.getCanSplit() ? "transfer_split" : "transfer", params);
    let result = resp.result;
    
    // pre-initialize txs iff present.  multisig and watch-only wallets will have tx set without transactions
    let txs;
    let numTxs = request.getCanSplit() ? (result.fee_list !== undefined ? result.fee_list.length : 0) : (result.fee !== undefined ? 1 : 0);
    if (numTxs > 0) txs = [];
    for (let i = 0; i < numTxs; i++) {
      let tx = new MoneroTxWallet();
      MoneroWalletRpc._initSentTxWallet(request, tx);
      tx.getOutgoingTransfer().setAccountIndex(accountIdx);
      if (subaddressIndices !== undefined && subaddressIndices.length === 1) tx.getOutgoingTransfer().setSubaddressIndices(subaddressIndices);
      txs.push(tx);
    }
    
    // initialize tx set from rpc response with pre-initialized txs
    if (request.getCanSplit()) return MoneroWalletRpc._convertRpcSentTxsToTxSet(result, txs);
    else return MoneroWalletRpc._convertRpcTxToTxSet(result, txs === undefined ? undefined : txs[0], true);
  }
  
  async sweepOutput(requestOrAddress, keyImage, priority) {
    
    // normalize and validate request
    let request;
    if (requestOrAddress instanceof MoneroSendRequest) {
      assert.equal(arguments.length, 1, "sweepOutput() requires a send request or parameters but both");
      request = requestOrAddress;
    } else {
      if (requestOrAddress instanceof Object) request = new MoneroSendRequest(requestOrAddress);
      else {
        request = new MoneroSendRequest(requestOrAddress, undefined, priority);
        request.setKeyImage(keyImage);
      }
    }
    assert.equal(request.getSweepEachSubaddress(), undefined);
    assert.equal(request.getBelowAmount(), undefined);
    assert.equal(request.getCanSplit(), undefined, "Splitting is not applicable when sweeping output");
    
    // build request parameters
    let params = {};
    params.address = request.getDestinations()[0].getAddress();
    params.account_index = request.getAccountIndex();
    params.subaddr_indices = request.getSubaddressIndices();
    params.key_image = request.getKeyImage();
    params.mixin = request.getMixin();
    params.ring_size = request.getRingSize();
    params.unlock_time = request.getUnlockTime();
    params.do_not_relay = request.getDoNotRelay();
    assert(request.getPriority() === undefined || request.getPriority() >= 0 && request.getPriority() <= 3);
    params.priority = request.getPriority();
    params.payment_id = request.getPaymentId();
    params.get_tx_key = true;
    params.get_tx_hex = true;
    params.get_tx_metadata = true;
    
    // send request
    let resp = await this.config.rpc.sendJsonRequest("sweep_single", params);
    let result = resp.result;
    
    // build and return tx response
    let tx = MoneroWalletRpc._initSentTxWallet(request, null);
    let txSet = MoneroWalletRpc._convertRpcTxToTxSet(result, tx, true);
    tx.getOutgoingTransfer().getDestinations()[0].setAmount(tx.getOutgoingTransfer().getAmount());  // initialize destination amount
    return txSet;
  }
  
  async sweepUnlocked(request) {
    
    // validate request
    if (request === undefined) throw new MoneroError("Must specify sweep request");
    if (request.getDestinations() === undefined || request.getDestinations().length != 1) throw new MoneroError("Must specify exactly one destination to sweep to");
    if (request.getDestinations()[0].getAddress() === undefined) throw new MoneroError("Must specify destination address to sweep to");
    if (request.getDestinations()[0].getAmount() !== undefined) throw new MoneroError("Cannot specify amount in sweep request");
    if (request.getKeyImage() !== undefined) throw new MoneroError("Key image defined; use sweepOutput() to sweep an output by its key image");
    if (request.getSubaddressIndices() !== undefined && request.getSubaddressIndices().length === 0) request.setSubaddressIndices(undefined);
    if (request.getAccountIndex() === undefined && request.getSubaddressIndices() !== undefined) throw new MoneroError("Must specify account index if subaddress indices are specified");
    
    // determine account and subaddress indices to sweep; default to all with unlocked balance if not specified
    let indices = new Map();  // maps each account index to subaddress indices to sweep
    if (request.getAccountIndex() !== undefined) {
      if (request.getSubaddressIndices() !== undefined) {
        indices.set(request.getAccountIndex(), request.getSubaddressIndices());
      } else {
        let subaddressIndices = [];
        indices.set(request.getAccountIndex(), subaddressIndices);
        for (let subaddress of await this.getSubaddresses(request.getAccountIndex())) {
          if (subaddress.getUnlockedBalance().compare(new BigInteger(0)) > 0) subaddressIndices.push(subaddress.getIndex());
        }
      }
    } else {
      let accounts = await this.getAccounts(true);
      for (let account of accounts) {
        if (account.getUnlockedBalance().compare(new BigInteger(0)) > 0) {
          let subaddressIndices = [];
          indices.set(account.getIndex(), subaddressIndices);
          for (let subaddress of account.getSubaddresses()) {
            if (subaddress.getUnlockedBalance().compare(new BigInteger(0)) > 0) subaddressIndices.push(subaddress.getIndex());
          }
        }
      }
    }
    
    // sweep from each account and collect resulting tx sets
    let txSets = [];
    for (let accountIdx of indices.keys()) {
      
      // copy and modify the original request
      let copy = request.copy();
      copy.setAccountIndex(accountIdx);
      copy.setSweepEachSubaddress(false);
      
      // sweep all subaddresses together  // TODO monero core: can this reveal outputs belong to the same wallet?
      if (copy.getSweepEachSubaddress() !== true) {
        copy.setSubaddressIndices(indices.get(accountIdx));
        txSets.push(await this._rpcSweepAccount(copy));
      }
      
      // otherwise sweep each subaddress individually
      else {
        for (let subaddressIdx of indices.get(accountIdx)) {
          copy.setSubaddressIndices([subaddressIdx]);
          txSets.push(await this._rpcSweepAccount(copy));
        }
      }
    }
    
    // return resulting tx sets
    return txSets;
  }
  
  async sweepDust(doNotRelay) {
    let resp = await this.config.rpc.sendJsonRequest("sweep_dust", {do_not_relay: doNotRelay});
    let result = resp.result;
    let txSet = MoneroWalletRpc._convertRpcSentTxsToTxSet(result);
    if (txSet.getTxs() !== undefined) {
      for (let tx of txSet.getTxs()) {
        tx.setIsRelayed(!doNotRelay);
        tx.setInTxPool(tx.isRelayed());
      }
    } else if (txSet.getMultisigTxHex() === undefined && txSet.getSignedTxHex() === undefined && txSet.getUnsignedTxHex() === undefined) {
      throw new MoneroError("No dust to sweep");
    }
    return txSet;
  }
  
  async sign(msg) {
    let resp = await this.config.rpc.sendJsonRequest("sign", {data: msg});
    return resp.result.signature;
  }
  
  async verify(msg, address, signature) {
    let resp = await this.config.rpc.sendJsonRequest("verify", {data: msg, address: address, signature: signature});
    return resp.result.good;
  }
  
  async getTxKey(txId) {
    return (await this.config.rpc.sendJsonRequest("get_tx_key", {txid: txId})).result.tx_key;
  }
  
  async checkTxKey(txId, txKey, address) {
    
    // send request
    let resp = await this.config.rpc.sendJsonRequest("check_tx_key", {txid: txId, tx_key: txKey, address: address});
    
    // interpret result
    let check = new MoneroCheckTx();
    check.setIsGood(true);
    check.setNumConfirmations(resp.result.confirmations);
    check.setInTxPool(resp.result.in_pool);
    check.setReceivedAmount(new BigInteger(resp.result.received));
    return check;
  }
  
  async getTxProof(txId, address, message) {
    let resp = await this.config.rpc.sendJsonRequest("get_tx_proof", {txid: txId, address: address, message: message});
    return resp.result.signature;
  }
  
  async checkTxProof(txId, address, message, signature) {
    
    // send request
    let resp = await this.config.rpc.sendJsonRequest("check_tx_proof", {
      txid: txId,
      address: address,
      message: message,
      signature: signature
    });
    
    // interpret response
    let isGood = resp.result.good;
    let check = new MoneroCheckTx();
    check.setIsGood(isGood);
    if (isGood) {
      check.setNumConfirmations(resp.result.confirmations);
      check.setInTxPool(resp.result.in_pool);
      check.setReceivedAmount(new BigInteger(resp.result.received));
    }
    return check;
  }
  
  async getSpendProof(txId, message) {
    let resp = await this.config.rpc.sendJsonRequest("get_spend_proof", {txid: txId, message: message});
    return resp.result.signature;
  }
  
  async checkSpendProof(txId, message, signature) {
    let resp = await this.config.rpc.sendJsonRequest("check_spend_proof", {
      txid: txId,
      message: message,
      signature: signature
    });
    return resp.result.good;
  }
  
  async getReserveProofWallet(message) {
    let resp = await this.config.rpc.sendJsonRequest("get_reserve_proof", {
      all: true,
      message: message
    });
    return resp.result.signature;
  }
  
  async getReserveProofAccount(accountIdx, amount, message) {
    let resp = await this.config.rpc.sendJsonRequest("get_reserve_proof", {
      account_index: accountIdx,
      amount: amount.toString(),
      message: message
    });
    return resp.result.signature;
  }

  async checkReserveProof(address, message, signature) {
    
    // send request
    let resp = await this.config.rpc.sendJsonRequest("check_reserve_proof", {
      address: address,
      message: message,
      signature: signature
    });
    
    // interpret results
    let isGood = resp.result.good;
    let check = new MoneroCheckReserve();
    check.setIsGood(isGood);
    if (isGood) {
      check.setUnconfirmedSpentAmount(new BigInteger(resp.result.spent));
      check.setTotalAmount(new BigInteger(resp.result.total));
    }
    return check;
  }
  
  async getTxNotes(txIds) {
    return (await this.config.rpc.sendJsonRequest("get_tx_notes", {txids: txIds})).result.notes;
  }
  
  async setTxNotes(txIds, notes) {
    await this.config.rpc.sendJsonRequest("set_tx_notes", {txids: txIds, notes: notes});
  }
  
  async getAddressBookEntries(entryIndices) {
    let resp = await this.config.rpc.sendJsonRequest("get_address_book", {entries: entryIndices});
    if (!resp.result.entries) return [];
    let entries = [];
    for (let rpcEntry of resp.result.entries) {
      entries.push(new MoneroAddressBookEntry(rpcEntry.index, rpcEntry.address, rpcEntry.payment_id, rpcEntry.description));
    }
    return entries;
  }
  
  async addAddressBookEntry(address, description, paymentId) {
    let resp = await this.config.rpc.sendJsonRequest("add_address_book", {address: address, description: description, payment_id: paymentId});
    return resp.result.index;
  }
  
  async deleteAddressBookEntry(entryIdx) {
    await this.config.rpc.sendJsonRequest("delete_address_book", {index: entryIdx});
  }
  
  async tagAccounts(tag, accountIndices) {
    await this.config.rpc.sendJsonRequest("tag_accounts", {tag: tag, accounts: accountIndices});
  }

  async untagAccounts(accountIndices) {
    await this.config.rpc.sendJsonRequest("untag_accounts", {accounts: accountIndices});
  }

  async getAccountTags() {
    let tags = [];
    let resp = await this.config.rpc.sendJsonRequest("get_account_tags");
    if (resp.result.account_tags) {
      for (let rpcAccountTag of resp.result.account_tags) {
        tags.push(new MoneroAccountTag(rpcAccountTag.tag ? rpcAccountTag.tag : undefined, rpcAccountTag.label ? rpcAccountTag.label : undefined, rpcAccountTag.accounts));
      }
    }
    return tags;
  }

  async setAccountTagLabel(tag, label) {
    await this.config.rpc.sendJsonRequest("set_account_tag_description", {tag: tag, description: label});
  }
  
  async createPaymentUri(request) {
    assert(request, "Must provide send request to create a payment URI");
    let resp = await this.config.rpc.sendJsonRequest("make_uri", {
      address: request.getDestinations()[0].getAddress(),
      amount: request.getDestinations()[0].getAmount() ? request.getDestinations()[0].getAmount().toString() : undefined,
      payment_id: request.getPaymentId(),
      recipient_name: request.getRecipientName(),
      tx_description: request.getNote()
    });
    return resp.result.uri;
  }
  
  async parsePaymentUri(uri) {
    assert(uri, "Must provide URI to parse");
    let resp = await this.config.rpc.sendJsonRequest("parse_uri", {uri: uri});
    let request = new MoneroSendRequest(resp.result.uri.address, new BigInteger(resp.result.uri.amount));
    request.setPaymentId(resp.result.uri.payment_id);
    request.setRecipientName(resp.result.uri.recipient_name);
    request.setNote(resp.result.uri.tx_description);
    if ("" === request.getDestinations()[0].getAddress()) request.getDestinations()[0].setAddress(undefined);
    if ("" === request.getPaymentId()) request.setPaymentId(undefined);
    if ("" === request.getRecipientName()) request.setRecipientName(undefined);
    if ("" === request.getNote()) request.setNote(undefined);
    return request;
  }
  
  async getAttribute(key) {
    let resp = await this.config.rpc.sendJsonRequest("get_attribute", {key: key});
    return resp.result.value === "" ? undefined : resp.result.value;
  }
  
  async setAttribute(key, val) {
    await this.config.rpc.sendJsonRequest("set_attribute", {key: key, value: val});
  }
  
  async startMining(numThreads, backgroundMining, ignoreBattery) {
    await this.config.rpc.sendJsonRequest("start_mining", {
      threads_count: numThreads,
      do_background_mining: backgroundMining,
      ignore_battery: ignoreBattery
    });
  }
  
  async stopMining() {
    await this.config.rpc.sendJsonRequest("stop_mining");
  }
  
  async isMultisigImportNeeded() {
    let resp = await this.config.rpc.sendJsonRequest("get_balance");
    return resp.result.multisig_import_needed === true;
  }
  
  async getMultisigInfo() {
    let resp = await this.config.rpc.sendJsonRequest("is_multisig");
    let result = resp.result;
    let info = new MoneroMultisigInfo();
    info.setIsMultisig(result.multisig);
    info.setIsReady(result.ready);
    info.setThreshold(result.threshold);
    info.setNumParticipants(result.total);
    return info;
  }
  
  async prepareMultisig() {
    let resp = await this.config.rpc.sendJsonRequest("prepare_multisig");
    let result = resp.result;
    return result.multisig_info;
  }
  
  async makeMultisig(multisigHexes, threshold, password) {
    let resp = await this.config.rpc.sendJsonRequest("make_multisig", {
      multisig_info: multisigHexes,
      threshold: threshold,
      password: password
    });
    let result = resp.result;
    let msResult = new MoneroMultisigInitResult();
    msResult.setAddress(result.address);
    msResult.setMultisigHex(result.multisig_info);
    if (msResult.getAddress().length === 0) msResult.setAddress(undefined);
    if (msResult.getMultisigHex().length === 0) msResult.setMultisigHex(undefined);
    return msResult;
  }
  
  async finalizeMultisig(multisigHexes, password) {
    let resp = await this.config.rpc.sendJsonRequest("finalize_multisig", {multisig_info: multisigHexes, password: password});
    let address = resp.result.address;
    return address.length === 0 ? undefined : address;
  }
  
  async exchangeMultisigKeys(multisigHexes, password) {
    let resp = await this.config.rpc.sendJsonRequest("exchange_multisig_keys", {multisig_info: multisigHexes, password: password});
    let msResult = new MoneroMultisigInitResult();
    msResult.setAddress(resp.result.address);
    msResult.setMultisigHex(resp.result.multisig_info);
    if (msResult.getAddress().length === 0) msResult.setAddress(undefined);
    if (msResult.getMultisigHex().length === 0) msResult.setMultisigHex(undefined);
    return msResult;
  }
  
  async getMultisigHex() {
    let resp = await this.config.rpc.sendJsonRequest("export_multisig_info");
    return resp.result.info;
  }

  async importMultisigHex(multisigHexes) {
    let resp = await this.config.rpc.sendJsonRequest("import_multisig_info", {info: multisigHexes});
    return resp.result.n_outputs;
  }

  async signMultisigTxHex(multisigTxHex) {
    let resp = await this.config.rpc.sendJsonRequest("sign_multisig", {tx_data_hex: multisigTxHex});
    let result = resp.result;
    let signResult = new MoneroMultisigSignResult();
    signResult.setSignedMultisigTxHex(result.tx_data_hex);
    signResult.setTxIds(result.tx_hash_list);
    return signResult;
  }

  async submitMultisigTxHex(signedMultisigTxHex) {
    let resp = await this.config.rpc.sendJsonRequest("submit_multisig", {tx_data_hex: signedMultisigTxHex});
    return resp.result.tx_hash_list;
  }
  
  async save() {
    await this.config.rpc.sendJsonRequest("store");
  }
  
  async close(save) {
    if (save === undefined) save = false;
    delete this.addressCache;
    this.addressCache = {};
    this.path = undefined;
    await this.config.rpc.sendJsonRequest("close_wallet", {autosave_current: save});
  }
  
  // --------------------------------  PRIVATE --------------------------------
  
  async _getBalances(accountIdx, subaddressIdx) {
    if (accountIdx === undefined) {
      assert.equal(subaddressIdx, undefined, "Must provide account index with subaddress index");
      let balance = new BigInteger(0);
      let unlockedBalance = new BigInteger(0);
      for (let account of await this.getAccounts()) {
        balance = balance.add(account.getBalance());
        unlockedBalance = unlockedBalance.add(account.getUnlockedBalance());
      }
      return [balance, unlockedBalance];
    } else {
      let params = {account_index: accountIdx, address_indices: subaddressIdx === undefined ? undefined : [subaddressIdx]};
      let resp = await this.config.rpc.sendJsonRequest("get_balance", params);
      if (subaddressIdx === undefined) return [new BigInteger(resp.result.balance), new BigInteger(resp.result.unlocked_balance)];
      else return [new BigInteger(resp.result.per_subaddress[0].balance), new BigInteger(resp.result.per_subaddress[0].unlocked_balance)];
    }
  }
  
  async _getAccountIndices(getSubaddressIndices) {
    let indices = new Map();
    for (let account of await this.getAccounts()) {
      indices.set(account.getIndex(), getSubaddressIndices ? await this._getSubaddressIndices(account.getIndex()) : undefined);
    }
    return indices;
  }
  
  async _getSubaddressIndices(accountIdx) {
    let subaddressIndices = [];
    let resp = await this.config.rpc.sendJsonRequest("get_address", {account_index: accountIdx});
    for (let address of resp.result.addresses) subaddressIndices.push(address.address_index);
    return subaddressIndices;
  }
  
  /**
   * Common method to get key images.
   * 
   * @param all specifies to get all xor only new images from last import
   * @return {MoneroKeyImage[]} are the key images
   */
  async _rpcExportKeyImages(all) {
    let resp = await this.config.rpc.sendJsonRequest("export_key_images", {all: all});
    if (!resp.result.signed_key_images) return [];
    return resp.result.signed_key_images.map(rpcImage => new MoneroKeyImage(rpcImage.key_image, rpcImage.signature));
  }
  
  async _rpcSweepAccount(request) {
    
    // validate request
    if (request === undefined) throw new MoneroError("Must specify sweep request");
    if (request.getAccountIndex() === undefined) throw new MoneroError("Must specify an account index to sweep from");
    if (request.getDestinations() === undefined || request.getDestinations().length != 1) throw new MoneroError("Must specify exactly one destination to sweep to");
    if (request.getDestinations()[0].getAddress() === undefined) throw new MoneroError("Must specify destination address to sweep to");
    if (request.getDestinations()[0].getAmount() !== undefined) throw new MoneroError("Cannot specify amount in sweep request");
    if (request.getKeyImage() !== undefined) throw new MoneroError("Key image defined; use sweepOutput() to sweep an output by its key image");
    if (request.getSubaddressIndices() !== undefined && request.getSubaddressIndices().length === 0) request.setSubaddressIndices(undefined);
    if (request.getSweepEachSubaddress()) throw new MoneroError("Cannot sweep each subaddress with RPC `sweep_all`");
    
    // sweep from all subaddresses if not otherwise defined
    if (request.getSubaddressIndices() === undefined) {
      request.setSubaddressIndices([]);
      for (let subaddress of await this.getSubaddresses(request.getAccountIndex())) {
        request.getSubaddressIndices().push(subaddress.getIndex());
      }
    }
    if (request.getSubaddressIndices().length === 0) throw new MoneroError("No subaddresses to sweep from");
    
    // common request params
    let params = {};
    params.account_index = request.getAccountIndex();
    params.subaddr_indices = request.getSubaddressIndices();
    params.address = request.getDestinations()[0].getAddress();
    assert(request.getPriority() === undefined || request.getPriority() >= 0 && request.getPriority() <= 3);
    params.priority = request.getPriority();
    params.mixin = request.getMixin();
    params.ring_size = request.getRingSize();
    params.unlock_time = request.getUnlockTime();
    params.payment_id = request.getPaymentId();
    params.do_not_relay = request.getDoNotRelay();
    params.below_amount = request.getBelowAmount();
    params.get_tx_keys = true;
    params.get_tx_hex = true;
    params.get_tx_metadata = true;
    
    // invoke wallet rpc `sweep_all`
    let resp = await this.config.rpc.sendJsonRequest("sweep_all", params);
    let result = resp.result;
    
    // initialize txs from response
    let txSet = MoneroWalletRpc._convertRpcSentTxsToTxSet(result);
    
    // initialize remaining known fields
    for (let tx of txSet.getTxs()) {
      tx.setIsConfirmed(false);
      tx.setNumConfirmations(0);
      tx.setInTxPool(!request.getDoNotRelay());
      tx.setDoNotRelay(request.getDoNotRelay());
      tx.setIsRelayed(!tx.getDoNotRelay());
      tx.setIsMinerTx(false);
      tx.setIsFailed(false);
      tx.setMixin(request.getMixin());
      let transfer = tx.getOutgoingTransfer();
      transfer.setAccountIndex(request.getAccountIndex());
      if (request.getSubaddressIndices().length === 1) transfer.setSubaddressIndices(request.getSubaddressIndices()); // TODO: deep copy
      let destination = new MoneroDestination(request.getDestinations()[0].getAddress(), new BigInteger(transfer.getAmount()));
      transfer.setDestinations([destination]);
      tx.setOutgoingTransfer(transfer);
      tx.setPaymentId(request.getPaymentId());
      if (tx.getUnlockTime() === undefined) tx.setUnlockTime(request.getUnlockTime() === undefined ? 0 : request.getUnlockTime());
      if (!tx.getDoNotRelay()) {
        if (tx.getLastRelayedTimestamp() === undefined) tx.setLastRelayedTimestamp(+new Date().getTime());  // TODO (monero-wallet-rpc): provide timestamp on response; unconfirmed timestamps vary
        if (tx.isDoubleSpendSeen() === undefined) tx.setIsDoubleSpend(false);
      }
    }
    return txSet;
    
    // initialize txs from response
    let txs = MoneroWalletRpc._convertRpcSentTxWallets(result, undefined);
  }
  
  // ---------------------------- PRIVATE STATIC ------------------------------
  
  static _convertRpcAccount(rpcAccount) {
    let account = new MoneroAccount();
    for (let key of Object.keys(rpcAccount)) {
      let val = rpcAccount[key];
      if (key === "account_index") account.setIndex(val);
      else if (key === "balance") account.setBalance(new BigInteger(val));
      else if (key === "unlocked_balance") account.setUnlockedBalance(new BigInteger(val));
      else if (key === "base_address") account.setPrimaryAddress(val);
      else if (key === "tag") account.setTag(val);
      else if (key === "label") { } // label belongs to first subaddress
      else console.log("WARNING: ignoring unexpected account field: " + key + ": " + val);
    }
    return account;
  }
  
  static _convertRpcSubaddress(rpcSubaddress) {
    let subaddress = new MoneroSubaddress();
    for (let key of Object.keys(rpcSubaddress)) {
      let val = rpcSubaddress[key];
      if (key === "account_index") subaddress.setAccountIndex(val);
      else if (key === "address_index") subaddress.setIndex(val);
      else if (key === "address") subaddress.setAddress(val);
      else if (key === "balance") subaddress.setBalance(new BigInteger(val));
      else if (key === "unlocked_balance") subaddress.setUnlockedBalance(new BigInteger(val));
      else if (key === "num_unspent_outputs") subaddress.setNumUnspentOutputs(val);
      else if (key === "label") { if (val) subaddress.setLabel(val); }
      else if (key === "used") subaddress.setIsUsed(val);
      else if (key === "blocks_to_unlock") subaddress.setNumBlocksToUnlock(val);
      else console.log("WARNING: ignoring unexpected subaddress field: " + key + ": " + val);
    }
    return subaddress;
  }
  
  /**
   * Initializes a sent transaction.
   * 
   * @param {MoneroSendRequest} request is the send request
   * @param {MoneroTxWallet} is an existing transaction to initialize (optional)
   * @return {MoneroTxWallet} is the initialized send tx
   */
  static _initSentTxWallet(request, tx) {
    if (!tx) tx = new MoneroTxWallet();
    tx.setIsConfirmed(false);
    tx.setNumConfirmations(0);
    tx.setInTxPool(request.getDoNotRelay() ? false : true);
    tx.setDoNotRelay(request.getDoNotRelay() ? true : false);
    tx.setIsRelayed(!tx.getDoNotRelay());
    tx.setIsMinerTx(false);
    tx.setIsFailed(false);
    tx.setMixin(request.getMixin());
    let transfer = new MoneroOutgoingTransfer().setTx(tx);
    if (request.getSubaddressIndices() && request.getSubaddressIndices().length === 1) transfer.setSubaddressIndices(request.getSubaddressIndices().slice(0)); // we know src subaddress indices iff request specifies 1
    let destCopies = [];
    for (let dest of request.getDestinations()) destCopies.push(dest.copy());
    transfer.setDestinations(destCopies);
    tx.setOutgoingTransfer(transfer);
    tx.setPaymentId(request.getPaymentId());
    if (tx.getUnlockTime() === undefined) tx.setUnlockTime(request.getUnlockTime() === undefined ? 0 : request.getUnlockTime());
    if (!tx.getDoNotRelay()) {
      if (tx.getLastRelayedTimestamp() === undefined) tx.setLastRelayedTimestamp(+new Date().getTime());  // TODO (monero-wallet-rpc): provide timestamp on response; unconfirmed timestamps vary
      if (tx.isDoubleSpendSeen() === undefined) tx.setIsDoubleSpend(false);
    }
    return tx;
  }
  
  /**
   * Initializes a tx set from a RPC map excluding txs.
   * 
   * @param rpcMap is the map to initialize the tx set from
   * @return MoneroTxSet is the initialized tx set
   * @return the resulting tx set
   */
  static _convertRpcMapToTxSet(rpcMap) {
    let txSet = new MoneroTxSet();
    txSet.setMultisigTxHex(rpcMap.multisig_txset);
    txSet.setUnsignedTxHex(rpcMap.unsigned_txset);
    txSet.setSignedTxHex(rpcMap.signed_txset);
    if (txSet.getMultisigTxHex() !== undefined && txSet.getMultisigTxHex().length === 0) txSet.setMultisigTxHex(undefined);
    if (txSet.getUnsignedTxHex() !== undefined && txSet.getUnsignedTxHex().length === 0) txSet.setUnsignedTxHex(undefined);
    if (txSet.getSignedTxHex() !== undefined && txSet.getSignedTxHex().length === 0) txSet.setSignedTxHex(undefined);
    return txSet;
  }
  
  /**
   * Initializes a MoneroTxSet from from a list of rpc txs.
   * 
   * @param rpcTxs are sent rpc txs to initialize the set from
   * @param txs are existing txs to further initialize (optional)
   * @return the converted tx set
   */
  static _convertRpcSentTxsToTxSet(rpcTxs, txs) {
    
    // build shared tx set
    let txSet = MoneroWalletRpc._convertRpcMapToTxSet(rpcTxs);
    
    // done if rpc contains no txs
    if (rpcTxs.fee_list === undefined) {
      if (txs !== undefined) throw new MoneorException("Txs must be null if rpcTxs are null");
      return txSet;
    }
    
    // get lists
    let ids = rpcTxs.tx_hash_list;
    let keys = rpcTxs.tx_key_list;
    let blobs = rpcTxs.tx_blob_list;
    let metadatas = rpcTxs.tx_metadata_list;
    let fees = rpcTxs.fee_list;
    let amounts = rpcTxs.amount_list
    
    // ensure all lists are the same size
    let sizes = new Set();
    if (ids !== undefined) sizes.add(ids.length);
    if (keys !== undefined) sizes.add(keys.length);
    if (blobs !== undefined) sizes.add(blobs.length);
    if (metadatas !== undefined) sizes.add(metadatas.length);
    if (fees !== undefined) sizes.add(fees.length);
    if (amounts !== undefined) sizes.add(amounts.length);
    assert.equal(sizes.size, 1, "RPC lists are different sizes");
    
    // pre-initialize txs if none given
    if (txs !== undefined) txSet.setTxs(txs);
    else {
      txs = [];
      for (let i = 0; i < fees.length; i++) txs.push(new MoneroTxWallet());
      txSet.setTxs(txs);
    }

    // build transactions
    for (let i = 0; i < fees.length; i++) {
      let tx = txs[i];
      if (ids !== undefined) tx.setId(ids[i]);
      if (keys !== undefined) tx.setKey(keys[i]);
      if (blobs !== undefined) tx.setFullHex(blobs[i]);
      if (metadatas !== undefined) tx.setMetadata(metadatas[i]);
      tx.setFee(new BigInteger(fees[i]));
      if (tx.getOutgoingTransfer() !== undefined) tx.getOutgoingTransfer().setAmount(new BigInteger(amounts[i]));
      else tx.setOutgoingTransfer(new MoneroOutgoingTransfer().setTx(tx).setAmount(new BigInteger(amounts[i])));
      tx.setTxSet(txSet); // link tx to parent set
    }
    
    return txSet;
  }
  
  /**
   * Converts a rpc tx with a transfer to a tx set with a tx and transfer.
   * 
   * @param rpcTx is the rpc tx to build from
   * @param tx is an existing tx to continue initializing (optional)
   * @param isOutgoing specifies if the tx is outgoing if true, incoming if false, or decodes from type if undefined
   * @returns the initialized tx set with a tx
   */
  static _convertRpcTxToTxSet(rpcTx, tx, isOutgoing) {
    let txSet = MoneroWalletRpc._convertRpcMapToTxSet(rpcTx);
    txSet.setTxs([MoneroWalletRpc._convertRpcTxWithTransfer(rpcTx, tx, isOutgoing).setTxSet(txSet)]);
    return txSet;
  }
  
  /**
   * Builds a MoneroTxWallet from a RPC tx.
   * 
   * @param rpcTx is the rpc tx to build from
   * @param tx is an existing tx to continue initializing (optional)
   * @param isOutgoing specifies if the tx is outgoing if true, incoming if false, or decodes from type if undefined
   * @returns {MoneroTxWallet} is the initialized tx
   */
  static _convertRpcTxWithTransfer(rpcTx, tx, isOutgoing) {  // TODO: change everything to safe set
        
    // initialize tx to return
    if (!tx) tx = new MoneroTxWallet();
    
    // initialize tx state from rpc type
    if (rpcTx.type !== undefined) isOutgoing = MoneroWalletRpc._decodeRpcType(rpcTx.type, tx);
    else {
      assert.equal(typeof isOutgoing, "boolean", "Must indicate if tx is outgoing (true) xor incoming (false) since unknown");
      assert.equal(typeof tx.isConfirmed(), "boolean");
      assert.equal(typeof tx.inTxPool(), "boolean");
      assert.equal(typeof tx.isMinerTx(), "boolean");
      assert.equal(typeof tx.isFailed(), "boolean");
      assert.equal(typeof tx.getDoNotRelay(), "boolean");
    }
    
    // TODO: safe set
    // initialize remaining fields  TODO: seems this should be part of common function with DaemonRpc._convertRpcTx
    let header;
    let transfer;
    for (let key of Object.keys(rpcTx)) {
      let val = rpcTx[key];
      if (key === "txid") tx.setId(val);
      else if (key === "tx_hash") tx.setId(val);
      else if (key === "fee") tx.setFee(new BigInteger(val));
      else if (key === "note") { if (val) tx.setNote(val); }
      else if (key === "tx_key") tx.setKey(val);
      else if (key === "type") { } // type already handled
      else if (key === "tx_size") tx.setSize(val);
      else if (key === "unlock_time") tx.setUnlockTime(val);
      else if (key === "tx_blob") tx.setFullHex(val);
      else if (key === "tx_metadata") tx.setMetadata(val);
      else if (key === "double_spend_seen") tx.setIsDoubleSpend(val);
      else if (key === "block_height" || key === "height") {
        if (tx.isConfirmed()) {
          if (!header) header = new MoneroBlockHeader();
          header.setHeight(val);
        }
      }
      else if (key === "timestamp") {
        if (tx.isConfirmed()) {
          if (!header) header = new MoneroBlockHeader();
          header.setTimestamp(val);
        } else {
          // timestamp of unconfirmed tx is current request time
        }
      }
      else if (key === "confirmations") {
        if (!tx.isConfirmed()) tx.setNumConfirmations(0);
        else tx.setNumConfirmations(val);
      }
      else if (key === "suggested_confirmations_threshold") {
        if (transfer === undefined) transfer = (isOutgoing ? new MoneroOutgoingTransfer() : new MoneroIncomingTransfer()).setTx(tx);
        transfer.setNumSuggestedConfirmations(val);
      }
      else if (key === "amount") {
        if (transfer === undefined) transfer = (isOutgoing ? new MoneroOutgoingTransfer() : new MoneroIncomingTransfer()).setTx(tx);
        transfer.setAmount(new BigInteger(val));
      }
      else if (key === "address") {
        if (!isOutgoing) {
          if (!transfer) transfer = new MoneroIncomingTransfer().setTx(tx);
          transfer.setAddress(val);
        }
      }
      else if (key === "payment_id") {
        if (MoneroTxWallet.DEFAULT_PAYMENT_ID !== val) tx.setPaymentId(val);  // default is undefined
      }
      else if (key === "subaddr_index") assert(rpcTx.subaddr_indices);  // handled by subaddr_indices
      else if (key === "subaddr_indices") {
        if (!transfer) transfer = (isOutgoing ? new MoneroOutgoingTransfer() : new MoneroIncomingTransfer()).setTx(tx);
        let rpcIndices = val;
        transfer.setAccountIndex(rpcIndices[0].major);
        if (isOutgoing) {
          let subaddressIndices = [];
          for (let rpcIndex of rpcIndices) subaddressIndices.push(rpcIndex.minor);
          transfer.setSubaddressIndices(subaddressIndices);
        } else {
          assert.equal(rpcIndices.length, 1);
          transfer.setSubaddressIndex(rpcIndices[0].minor);
        }
      }
      else if (key === "destinations") {
        assert(isOutgoing);
        let destinations = [];
        for (let rpcDestination of val) {
          let destination = new MoneroDestination();
          destinations.push(destination);
          for (let destinationKey of Object.keys(rpcDestination)) {
            if (destinationKey === "address") destination.setAddress(rpcDestination[destinationKey]);
            else if (destinationKey === "amount") destination.setAmount(new BigInteger(rpcDestination[destinationKey]));
            else throw new MoneroError("Unrecognized transaction destination field: " + destinationKey);
          }
        }
        if (transfer === undefined) transfer = new MoneroOutgoingTransfer({tx: tx});
        transfer.setDestinations(destinations);
      }
      else if (key === "multisig_txset" && val !== undefined) {} // handled elsewhere; this method only builds a tx wallet
      else if (key === "unsigned_txset" && val !== undefined) {} // handled elsewhere; this method only builds a tx wallet
      else console.log("WARNING: ignoring unexpected transaction field: " + key + ": " + val);
    }
    
    // link block and tx
    if (header) tx.setBlock(new MoneroBlock(header).setTxs([tx]));
    
    // initialize final fields
    if (transfer) {
      if (isOutgoing) {
        if (tx.getOutgoingTransfer()) tx.getOutgoingTransfer().merge(transfer);
        else tx.setOutgoingTransfer(transfer);
      } else {
        tx.setIncomingTransfers([transfer]);
      }
    }
    
    // return initialized transaction
    return tx;
  }
  
  static _convertRpcTxWalletWithVout(rpcVout) {
    
    // initialize tx
    let tx = new MoneroTxWallet();
    tx.setIsConfirmed(true);
    tx.setIsRelayed(true);
    tx.setIsFailed(false);
    
    // initialize vout
    let vout = new MoneroOutputWallet({tx: tx});
    for (let key of Object.keys(rpcVout)) {
      let val = rpcVout[key];
      if (key === "amount") vout.setAmount(new BigInteger(val));
      else if (key === "spent") vout.setIsSpent(val);
      else if (key === "key_image") vout.setKeyImage(new MoneroKeyImage(val));
      else if (key === "global_index") vout.setIndex(val);
      else if (key === "tx_hash") tx.setId(val);
      else if (key === "unlocked") vout.setIsUnlocked(val);
      else if (key === "frozen") vout.setIsFrozen(val);
      else if (key === "subaddr_index") {
        vout.setAccountIndex(val.major);
        vout.setSubaddressIndex(val.minor);
      }
      else if (key === "block_height") tx.setBlock(new MoneroBlock().setHeight(val).setTxs([tx]));
      else console.log("WARNING: ignoring unexpected transaction field: " + key + ": " + val);
    }
    
    // initialize tx with vout
    tx.setVouts([vout]);
    return tx;
  }
  
  /**
   * Decodes a "type" from monero-wallet-rpc to initialize type and state
   * fields in the given transaction.
   * 
   * TODO: these should be safe set
   * 
   * @param rpcType is the type to decode
   * @param tx is the transaction to decode known fields to
   * @return {boolean} true if the rpc type indicates outgoing xor incoming
   */
  static _decodeRpcType(rpcType, tx) {
    let isOutgoing;
    if (rpcType === "in") {
      isOutgoing = false;
      tx.setIsConfirmed(true);
      tx.setInTxPool(false);
      tx.setIsRelayed(true);
      tx.setDoNotRelay(false);
      tx.setIsFailed(false);
      tx.setIsMinerTx(false);
    } else if (rpcType === "out") {
    	isOutgoing = true;
      tx.setIsConfirmed(true);
      tx.setInTxPool(false);
      tx.setIsRelayed(true);
      tx.setDoNotRelay(false);
      tx.setIsFailed(false);
      tx.setIsMinerTx(false);
    } else if (rpcType === "pool") {
    	isOutgoing = false;
      tx.setIsConfirmed(false);
      tx.setInTxPool(true);
      tx.setIsRelayed(true);
      tx.setDoNotRelay(false);
      tx.setIsFailed(false);
      tx.setIsMinerTx(false);  // TODO: but could it be?
    } else if (rpcType === "pending") {
    	isOutgoing = true;
      tx.setIsConfirmed(false);
      tx.setInTxPool(true);
      tx.setIsRelayed(true);
      tx.setDoNotRelay(false);
      tx.setIsFailed(false);
      tx.setIsMinerTx(false);
    } else if (rpcType === "block") {
    	isOutgoing = false;
      tx.setIsConfirmed(true);
      tx.setInTxPool(false);
      tx.setIsRelayed(true);
      tx.setDoNotRelay(false);
      tx.setIsFailed(false);
      tx.setIsMinerTx(true);
    } else if (rpcType === "failed") {
    	isOutgoing = true;
      tx.setIsConfirmed(false);
      tx.setInTxPool(false);
      tx.setIsRelayed(true);
      tx.setDoNotRelay(false);
      tx.setIsFailed(true);
      tx.setIsMinerTx(false);
    } else {
      throw new MoneroError("Unrecognized transfer type: " + rpcType);
    }
    return isOutgoing;
  }
  
  /**
   * Merges a transaction into a unique set of transactions.
   *
   * TODO monero core: skipIfAbsent only necessary because incoming payments not returned
   * when sent from/to same account #4500
   *
   * @param tx is the transaction to merge into the existing txs
   * @param txMap maps tx ids to txs
   * @param blockMap maps block heights to blocks
   * @param skipIfAbsent specifies if the tx should not be added if it doesn't already exist
   */
  static _mergeTx(tx, txMap, blockMap, skipIfAbsent) {
    assert(tx.getId() !== undefined);

    // if tx doesn't exist, add it (unless skipped)
    let aTx = txMap[tx.getId()];
    if (aTx === undefined) {
      if (!skipIfAbsent) {
        txMap[tx.getId()] = tx;
      } else {
        console.log("WARNING: tx does not already exist");
      }
    }

    // otherwise merge with existing tx
    else {
      aTx.merge(tx);
    }

    // if confirmed, merge tx's block
    if (tx.getHeight() !== undefined) {
      let aBlock = blockMap[tx.getHeight()];
      if (aBlock === undefined) {
        blockMap[tx.getHeight()] = tx.getBlock();
      } else {
        aBlock.merge(tx.getBlock());
      }
    }
  }
  
  /**
   * Compares two transactions by their height.
   */
  static _compareTxsByHeight(tx1, tx2) {
    if (tx1.getHeight() === undefined && tx2.getHeight() === undefined) return 0; // both unconfirmed
    else if (tx1.getHeight() === undefined) return 1;   // tx1 is unconfirmed
    else if (tx2.getHeight() === undefined) return -1;  // tx2 is unconfirmed
    let diff = tx1.getHeight() - tx2.getHeight();
    if (diff !== 0) return diff;
    return tx1.getBlock().getTxs().indexOf(tx1) - tx2.getBlock().getTxs().indexOf(tx2); // txs are in the same block so retain their original order
  }
  
  /**
   * Compares two transfers by ascending account and subaddress indices.
   */
  static _compareIncomingTransfers(t1, t2) {
    if (t1.getAccountIndex() < t2.getAccountIndex()) return -1;
    else if (t1.getAccountIndex() === t2.getAccountIndex()) return t1.getSubaddressIndex() - t2.getSubaddressIndex();
    return 1;
  }
  
  /**
   * Compares two vouts by ascending account and subaddress indices.
   */
  static _compareVouts(o1, o2) {
    
    // compare by height
    let heightComparison = MoneroWalletRpc._compareTxsByHeight(o1.getTx(), o2.getTx());
    if (heightComparison !== 0) return heightComparison;
    
    // compare by account index, subaddress index, and output
    if (o1.getAccountIndex() < o2.getAccountIndex()) return -1;
    else if (o1.getAccountIndex() === o2.getAccountIndex()) {
      let compare = o1.getSubaddressIndex() - o2.getSubaddressIndex();
      if (compare !== 0) return compare;
      return o1.getIndex() - o2.getIndex();
    }
    return 1;
  }
}

module.exports = MoneroWalletRpc;