var express = require('express');
var router = express.Router();
var util = require('util');
var moment = require('moment');
var utils = require('./../app/utils');
var env = require("./../app/env");
var bitcoinCore = require("bitcoin-core");
var rpcApi = require("./../app/rpcApi");
var qrcode = require('qrcode');
var bitcoinjs = require('bitcoinjs-lib');
var request = require('superagent');


router.get("/", function(req, res) {
	if (req.session.host == null || req.session.host.trim() == "") {
		if (req.cookies['rpc-host']) {
			res.locals.host = req.cookies['rpc-host'];
		}

		if (req.cookies['rpc-port']) {
			res.locals.port = req.cookies['rpc-port'];
		}

		if (req.cookies['rpc-username']) {
			res.locals.username = req.cookies['rpc-username'];
		}

		res.render("connect");
		res.end();

		return;
	}

	var client = global.client;

	rpcApi.getBlockchainInfo().then(function(getblockchaininfo) {
		res.locals.getblockchaininfo = getblockchaininfo;

		var blockHeights = [];
		if (getblockchaininfo.blocks) {
			for (var i = 0; i < 10; i++) {
				blockHeights.push(getblockchaininfo.blocks - i);
			}
		}

		rpcApi.getBlocksByHeight(blockHeights).then(function(latestBlocks) {
			res.locals.latestBlocks = latestBlocks;

			res.render("index");
		});
	}).catch(function(err) {
		res.locals.userMessage = "Unable to connect to node at " + env.rpc.host + ":" + env.rpc.port;

		res.render("index");
	});
});


/////////////// SUPPLY CALCs
function totalCoinsOld(nHeight) {
  var halveningBlocks = 210000 - 1;
  var halvings  = Math.floor(nHeight / halveningBlocks);
  var nSubsidy = 50.0;

  var totalSupply = 0;
  var halvenedBlocks = 0;
  var curSubsidy = Array(halvings + 1).join(',').split('').reduce(x => {
    halvenedBlocks += halveningBlocks;
    totalSupply += halveningBlocks * x;
    return x/2;
  }, nSubsidy);
  totalSupply += (nHeight - halvenedBlocks) * curSubsidy;

  // apply past adjustment of lost/unclaimed coins
  var adj = 2.579308461397886;
  adj += 50; // unspendable genesis block
  adj += 50; // duplicated coinbase #91880
  totalSupply -= adj;

  return totalSupply;
};
// POST 1 MIN FORK
function totalCoinsPost1min(nHeight) {
  var omhfHeight = 588673;
  var onHeight = nHeight;
  var halveningBlocks = 210000 * 10 - 1;
  var halvings  = Math.floor(nHeight / halveningBlocks);
  var nSubsidy = 50.0 / 40;

  var totalSupply = 0;
  var halvenedBlocks = 0;
  var curSubsidy = Array(halvings + 1).join(',').split('').reduce(x => {
    halvenedBlocks += halveningBlocks;
    totalSupply += halveningBlocks * x;
    return x/2;
  }, nSubsidy);
  totalSupply += (nHeight - halvenedBlocks) * curSubsidy;
  // apply past adjustment of lost/unclaimed coins
  var adj = 2.579308461397886;
  adj += 50 / 10; // unspendable genesis block
  adj += 50 / 10; // duplicated coinbase #91880
  totalSupply -= adj;

  return totalSupply;
};

function td(n) {
  return Math.round(n * 100) / 100;
}


function totalCoins(nHeight) {
  var omhfHeight = 588672;
  var onHeight = nHeight;
  if (nHeight > omhfHeight) {
    nHeight = omhfHeight;
  }
  var halveningBlocks = 210000 - 1;
  var halvings  = Math.floor(nHeight / halveningBlocks);
  var nSubsidy = 50.0;

  var totalSupply = 0;
  var halvenedBlocks = 0;
  var curSubsidy = Array(halvings + 1).join(',').split('').reduce(x => {
    halvenedBlocks += halveningBlocks;
    totalSupply += halveningBlocks * x;
    return x/2;
  }, nSubsidy);
  totalSupply += (nHeight - halvenedBlocks) * curSubsidy;

  // apply past adjustment of lost/unclaimed coins
  var adj = 2.579308461397886;
  adj += 50; // unspendable genesis block
  adj += 50; // duplicated coinbase #91880
  totalSupply -= adj;

  if (onHeight > omhfHeight) {
    totalSupply += totalCoinsPost1min(onHeight) - totalCoinsPost1min(omhfHeight);
  }
  return totalSupply;
};
///

var cachedBlockHeight = -1;
var lastCachedBlockHeightTime = Date.now();
var cacheHeightForSeconds = 5; // seconds of cache - const
function getCachedBlockheight(cb) {
     try {
        if (cachedBlockHeight !== -1) {
           if (Date.now() - lastCachedBlockHeightTime < cacheHeightForSeconds * 1000) {
                  // Serve cache
                  var blockCount = cachedBlockHeight;
                  var tc = Number(totalCoins(blockCount)).toFixed(8);
                  return cb(null, String(tc));
           }
        }
        var client = global.client;
        rpcApi.getBlockchainInfo().then(function(getblockchaininfo) {
                var blockCount = getblockchaininfo.blocks;
                cachedBlockHeight = blockCount;
                lastCachedBlockHeightTime = Date.now();
                var tc = Number(totalCoins(blockCount)).toFixed(8);
                cb(null, String(tc));
        });
    } catch (e) {
      console.error('Error getting cache blockheight:', e);
      cb(e);
    }
}
var getTotalCoins = getCachedBlockheight;
function getDifficulty(cb) {
      try {
	rpcApi.getDifficulty().then(function(diff) {
	     cb(null, diff);
        });
      } catch (e) {
        console.error('Error getDifficultying:', e);
	cb(e);
      }
}

router.get("/api/current-supply", function apiCurrentSupply(req, res) {
        getTotalCoins(function(err, height) {
            if (err) {
                return res.status(500).send("");
            }
            return res.send(height);
        });
});

router.get("/api/current-supply-sats", function apiCurrentSupplySats(req, res) {
        getTotalCoins(function(err, height) {
            if (err) {
                return res.status(500).send("");
            }
            return res.send(String(height).replace('.', ''));
        });
});


function getTNETInfo(cb) {
        var data = {};
        // Get: Current Supply
        getTotalCoins(function(err, totalcoins) {
            if (err) {
                return cb(500);
            }
            data['currentsupply'] = totalcoins;
            data['maxsupply'] = 21000000;
            // Get: Diff
            getDifficulty(function(err2, diff) {
              if (err2) {
                 return cb(500);
              }
              data['difficulty'] = diff;
	      // Get: exchange rate TNET_BTC (Cryptobridge)
	      if (!(global.exchangeRate > 0)) {
                 return cb(500);
              }
              data['btcc_btc'] = global.exchangeRate;
              // Get: exchange rate BTC_USD (CMC)
              request.get('https://api.coinmarketcap.com/v2/ticker/1/?convert=USD')
		.end(function (err, res) {
		    if (err) {
                       console.error('Error getting BTCUSD:CMC', err);
                       return cb(500);
                    }
		    var market = res.body.data.quotes.USD.price;
		    data['btc_usd'] = market;
                    data['btcc_usd'] = parseFloat((parseFloat(market, 10) * parseFloat(data['btcc_btc'], 10)).toFixed(2), 10);
		    // FINNN
                    data['lastupdate'] = parseInt(Date.now() / 1e3, 10);
                    cb(null, data);
                });
            });
            // return res.send(height);
        });
}

var lastTotalInfoCacheTime = Date.now();
var lastTotalCache = null;
var totalCacheLifetimeSeconds = 10; // seconds
function getCacheTNETInfo(cb) {
    if (lastTotalCache !== null) {
        if (Date.now() - lastTotalInfoCacheTime < totalCacheLifetimeSeconds * 1000) {
	     // alive
             return cb(null, lastTotalCache);
        }
   }

   getTNETInfo(function(err, info) {
      if (!err) {
        lastTotalCache = info;
        lastTotalInfoCacheTime = Date.now();
      }
      cb(err, info);
   });
}

router.get("/api/get-info", function apiGetInfo(req, res) {
        getCacheTNETInfo(function apiGetInfoInner(err, info) {
            if (err) {
                return res.status(500).send("{}");
            }
            res.send(info);
       });
});




// DISABLE
if (0)
router.get("/node-status", function(req, res) {
	var client = global.client;

	rpcApi.getBlockchainInfo().then(function(getblockchaininfo) {
		res.locals.getblockchaininfo = getblockchaininfo;

		rpcApi.getNetworkInfo().then(function(getnetworkinfo) {
			res.locals.getnetworkinfo = getnetworkinfo;

			rpcApi.getUptimeSeconds().then(function(uptimeSeconds) {
				res.locals.uptimeSeconds = uptimeSeconds;

				rpcApi.getNetTotals().then(function(getnettotals) {
					res.locals.getnettotals = getnettotals;

					res.render("node-status");

				}).catch(function(err) {
					res.locals.userMessage = "Unable to connect to node at " + env.rpc.host + ":" + env.rpc.port;

					res.render("node-status");
				});
			}).catch(function(err) {
				res.locals.userMessage = "Unable to connect to node at " + env.rpc.host + ":" + env.rpc.port;

				res.render("node-status");
			});
		}).catch(function(err) {
			res.locals.userMessage = "Unable to connect to node at " + env.rpc.host + ":" + env.rpc.port;

			res.render("node-status");
		});
	}).catch(function(err) {
		res.locals.userMessage = "Unable to connect to node at " + env.rpc.host + ":" + env.rpc.port;

		res.render("node-status");
	});
});

router.get("/mempool-summary", function(req, res) {
	var client = global.client;

	rpcApi.getMempoolInfo().then(function(getmempoolinfo) {
		res.locals.getmempoolinfo = getmempoolinfo;

		rpcApi.getMempoolStats().then(function(mempoolstats) {
			res.locals.mempoolstats = mempoolstats;

			res.render("mempool-summary");
		});
	}).catch(function(err) {
		res.locals.userMessage = "Unable to connect to Bitcoin Node at " + env.rpc.host + ":" + env.rpc.port;

		res.render("mempool-summary");
	});
});

if (0)
router.post("/connect", function(req, res) {
	var host = req.body.host;
	var port = req.body.port;
	var username = req.body.username;
	var password = req.body.password;

	res.cookie('rpc-host', host);
	res.cookie('rpc-port', port);
	res.cookie('rpc-username', username);

	req.session.host = host;
	req.session.port = port;
	req.session.username = username;

	var client = new bitcoinCore({
		host: host,
		port: port,
		username: username,
		password: password,
		timeout: 30000
	});

	console.log("created client: " + client);

	global.client = client;

	req.session.userMessage = "<strong>Connected via RPC</strong>: " + username + " @ " + host + ":" + port;
	req.session.userMessageType = "success";

	res.redirect("/");
});

if (0)
router.get("/disconnect", function(req, res) {
	res.cookie('rpc-host', "");
	res.cookie('rpc-port', "");
	res.cookie('rpc-username', "");

	req.session.host = "";
	req.session.port = "";
	req.session.username = "";

	console.log("destroyed client.");

	global.client = null;

	req.session.userMessage = "Disconnected from node.";
	req.session.userMessageType = "success";

	res.redirect("/");
});

if (0)
router.get("/changeSetting", function(req, res) {
	if (req.query.name) {
		req.session[req.query.name] = req.query.value;

		res.cookie('user-setting-' + req.query.name, req.query.value);
	}

	res.redirect(req.headers.referer);
});

router.get("/blocks", function(req, res) {
	var limit = 20;
	var offset = 0;
	var sort = "desc";

	if (req.query.limit) {
		limit = parseInt(req.query.limit);
	}

	if (req.query.offset) {
		offset = parseInt(req.query.offset);
	}

	if (req.query.sort) {
		sort = req.query.sort;
	}

	res.locals.limit = limit;
	res.locals.offset = offset;
	res.locals.sort = sort;
	res.locals.paginationBaseUrl = "/blocks";

	rpcApi.getBlockchainInfo().then(function(getblockchaininfo) {
		res.locals.blockCount = getblockchaininfo.blocks;
		res.locals.blockOffset = offset;

		var blockHeights = [];
		if (sort == "desc") {
			for (var i = (getblockchaininfo.blocks - offset); i > (getblockchaininfo.blocks - offset - limit); i--) {
				blockHeights.push(i);
			}
		} else {
			for (var i = offset; i < (offset + limit); i++) {
				blockHeights.push(i);
			}
		}

		rpcApi.getBlocksByHeight(blockHeights).then(function(blocks) {
			res.locals.blocks = blocks;

			res.render("blocks");
		});
	}).catch(function(err) {
		res.locals.userMessage = "Unable to connect to Bitcoin Node at " + env.rpc.host + ":" + env.rpc.port;

		res.render("blocks");
	});
});

router.post("/search", function(req, res) {
	if (!req.body.query) {
		req.session.userMessage = "Enter a block height, block hash, or transaction id.";

		res.redirect("/");

		return;
	}

	var query = req.body.query.toLowerCase().trim();
	var rawCaseQuery = req.body.query.trim();

	req.session.query = req.body.query;

	if (query.length == 64) {
		rpcApi.getRawTransaction(query).then(function(tx) {
			if (tx) {
				res.redirect("/tx/" + query);

				return;
			}

			rpcApi.getBlockByHash(query).then(function(blockByHash) {
				if (blockByHash) {
					res.redirect("/block/" + query);

					return;
				}

				rpcApi.getAddress(rawCaseQuery).then(function(validateaddress) {
					if (validateaddress && validateaddress.isvalid) {
						res.redirect("/address/" + rawCaseQuery);

						return;
					}
				});

				req.session.userMessage = "No results found for query: " + query;

				res.redirect("/");

			}).catch(function(err) {
				req.session.userMessage = "No results found for query: " + query;

				res.redirect("/");
			});

		}).catch(function(err) {
			rpcApi.getBlockByHash(query).then(function(blockByHash) {
				if (blockByHash) {
					res.redirect("/block/" + query);

					return;
				}

				req.session.userMessage = "No results found for query: " + query;

				res.redirect("/");

			}).catch(function(err) {
				req.session.userMessage = "No results found for query: " + query;

				res.redirect("/");
			});
		});

	} else if (!isNaN(query)) {
		rpcApi.getBlockByHeight(parseInt(query)).then(function(blockByHeight) {
			if (blockByHeight) {
				res.redirect("/block-height/" + query);

				return;
			}

			req.session.userMessage = "No results found for query: " + query;

			res.redirect("/");
		});
	} else {
		rpcApi.getAddress(rawCaseQuery).then(function(validateaddress) {
			if (validateaddress && validateaddress.isvalid) {
				res.redirect("/address/" + rawCaseQuery);

				return;
			}

			req.session.userMessage = "No results found for query: " + rawCaseQuery;

			res.redirect("/");
		});
	}
});

router.get("/block-height/:blockHeight", function(req, res) {
	var client = global.client;

	var blockHeight = parseInt(req.params.blockHeight);

	res.locals.blockHeight = blockHeight;

	res.locals.result = {};

	var limit = 20;
	var offset = 0;

	if (req.query.limit) {
		limit = parseInt(req.query.limit);
	}

	if (req.query.offset) {
		offset = parseInt(req.query.offset);
	}

	res.locals.limit = limit;
	res.locals.offset = offset;
	res.locals.paginationBaseUrl = "/block-height/" + blockHeight;

	client.command('getblockhash', blockHeight, function(err, result, resHeaders) {
		if (err) {
			// TODO handle RPC error
			return console.log(err);
		}

		res.locals.result.getblockhash = result;

		rpcApi.getBlockData(client, result, limit, offset).then(function(result) {
			res.locals.result.getblock = result.getblock;
			res.locals.result.transactions = result.transactions;
			res.locals.result.txInputsByTransaction = result.txInputsByTransaction;

			res.render("block-height");
		});
	});
});

router.get("/block/:blockHash", function(req, res) {
	var blockHash = req.params.blockHash;

	res.locals.blockHash = blockHash;

	res.locals.result = {};

	var limit = 20;
	var offset = 0;

	if (req.query.limit) {
		limit = parseInt(req.query.limit);
	}

	if (req.query.offset) {
		offset = parseInt(req.query.offset);
	}

	res.locals.limit = limit;
	res.locals.offset = offset;
	res.locals.paginationBaseUrl = "/block/" + blockHash;

	// TODO handle RPC error
	rpcApi.getBlockData(client, blockHash, limit, offset).then(function(result) {
		res.locals.result.getblock = result.getblock;
		res.locals.result.transactions = result.transactions;
		res.locals.result.txInputsByTransaction = result.txInputsByTransaction;

		res.render("block");
	});
});

router.get("/tx/:transactionId", function(req, res) {
	var txid = req.params.transactionId;

	var output = -1;
	if (req.query.output) {
		output = parseInt(req.query.output);
	}

	res.locals.txid = txid;
	res.locals.output = output;

	res.locals.result = {};

	rpcApi.getRawTransaction(txid).then(function(rawTxResult) {
		res.locals.result.getrawtransaction = rawTxResult;

		client.command('getblock', rawTxResult.blockhash, function(err3, result3, resHeaders3) {
			res.locals.result.getblock = result3;

			var txids = [];
			for (var i = 0; i < rawTxResult.vin.length; i++) {
				if (!rawTxResult.vin[i].coinbase) {
					txids.push(rawTxResult.vin[i].txid);
				}
			}

			rpcApi.getRawTransactions(txids).then(function(txInputs) {
				res.locals.result.txInputs = txInputs;

				res.render("transaction");
			});
		});
	}).catch(function(err) {
		res.locals.userMessage = "Failed to load transaction with txid=" + txid + " (" + err + ")";

		res.render("transaction");
	});
});

router.get("/address/:address", function(req, res) {
	var address = req.params.address;

	res.locals.address = address;
	
	res.locals.result = {};

	try {
		res.locals.addressObj = bitcoinjs.address.fromBase58Check(address);

	} catch (err) {
		console.log("Error u3gr02gwef: " + err);

		try {
			res.locals.addressObj = bitcoinjs.address.fromBech32(address);

		} catch (err2) {
			console.log("Error u02qg02yqge: " + err2);
		}
	}
	
	rpcApi.getAddress(address).then(function(result) {
		res.locals.result.validateaddress = result;

		qrcode.toDataURL(address, function(err, url) {
			if (err) {
				console.log("Error 93ygfew0ygf2gf2: " + err);
			}

			res.locals.addressQrCodeUrl = url;

			res.render("address");
		});
	}).catch(function(err) {
		res.locals.userMessage = "Failed to load address " + address + " (" + err + ")";

		res.render("address");
	});
});

if (0)
router.get("/rpc-terminal", function(req, res) {
	if (!env.demoSite) {
		var ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
		var match = env.ipWhitelistForRpcCommands.exec(ip);

		if (!match) {
			res.send("RPC Terminal / Browser may not be accessed from '" + ip + "'. This restriction can be modified in your env.js file.");

			return;
		}
	}

	res.render("terminal");
});

if (0)
router.post("/rpc-terminal", function(req, res) {
	if (!env.demoSite) {
		var ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
		var match = env.ipWhitelistForRpcCommands.exec(ip);

		if (!match) {
			res.send("RPC Terminal / Browser may not be accessed from '" + ip + "'. This restriction can be modified in your env.js file.");

			return;
		}
	}

	var params = req.body.cmd.split(" ");
	var cmd = params.shift();
	var parsedParams = [];

	params.forEach(function(param, i) {
		if (!isNaN(param)) {
			parsedParams.push(parseInt(param));

		} else {
			parsedParams.push(param);
		}
	});

	if (env.rpcBlacklist.includes(cmd)) {
		res.write("Sorry, that RPC command is blacklisted. If this is your server, you may allow this command by removing it from the 'rpcBlacklist' setting in env.js.", function() {
			res.end();
		});

		return;
	}

	client.command([{method:cmd, parameters:parsedParams}], function(err, result, resHeaders) {
		console.log("Result[1]: " + JSON.stringify(result, null, 4));
		console.log("Error[2]: " + JSON.stringify(err, null, 4));
		console.log("Headers[3]: " + JSON.stringify(resHeaders, null, 4));

		if (err) {
			console.log(JSON.stringify(err, null, 4));

			res.write(JSON.stringify(err, null, 4), function() {
				res.end();
			});

		} else if (result) {
			res.write(JSON.stringify(result, null, 4), function() {
				res.end();
			});

		} else {
			res.write(JSON.stringify({"Error":"No response from node"}, null, 4), function() {
				res.end();
			});
		}
	});
});

if (0)
router.get("/rpc-browser", function(req, res) {
	if (!env.demoSite) {
		var ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
		var match = env.ipWhitelistForRpcCommands.exec(ip);

		if (!match) {
			res.send("RPC Terminal / Browser may not be accessed from '" + ip + "'. This restriction can be modified in your env.js file.");

			return;
		}
	}

	rpcApi.getHelp().then(function(result) {
		res.locals.gethelp = result;

		if (req.query.method) {
			res.locals.method = req.query.method;

			rpcApi.getRpcMethodHelp(req.query.method.trim()).then(function(result2) {
				res.locals.methodhelp = result2;

				if (req.query.execute) {
					var argDetails = result2.args;
					var argValues = [];

					if (req.query.args) {
						for (var i = 0; i < req.query.args.length; i++) {
							var argProperties = argDetails[i].properties;

							for (var j = 0; j < argProperties.length; j++) {
								if (argProperties[j] == "numeric") {
									if (req.query.args[i] == null || req.query.args[i] == "") {
										argValues.push(null);

									} else {
										argValues.push(parseInt(req.query.args[i]));
									}

									break;

								} else if (argProperties[j] == "boolean") {
									if (req.query.args[i]) {
										argValues.push(req.query.args[i] == "true");
									}

									break;

								} else if (argProperties[j] == "string") {
									if (req.query.args[i]) {
										argValues.push(req.query.args[i]);
									}

									break;
								}
							}
						}
					}

					res.locals.argValues = argValues;

					if (env.rpcBlacklist.includes(req.query.method)) {
						res.locals.methodResult = "Sorry, that RPC command is blacklisted. If this is your server, you may allow this command by removing it from the 'rpcBlacklist' setting in env.js.";

						res.render("browser");

						return;
					}

					console.log("Executing RPC '" + req.query.method + "' with params: [" + argValues + "]");

					client.command([{method:req.query.method, parameters:argValues}], function(err3, result3, resHeaders3) {
						console.log("RPC Response: err=" + err3 + ", result=" + result3 + ", headers=" + resHeaders3);

						if (err3) {
							if (result3) {
								res.locals.methodResult = {error:("" + err3), result:result3};
								
							} else {
								res.locals.methodResult = {error:("" + err3)};
							}
						} else if (result3) {
							res.locals.methodResult = result3;

						} else {
							res.locals.methodResult = {"Error":"No response from node."};
						}

						res.render("browser");
					});
				} else {
					res.render("browser");
				}
			}).catch(function(err) {
				res.locals.userMessage = "Error loading help content for method " + req.query.method + ": " + err;

				res.render("browser");
			});

		} else {
			res.render("browser");
		}

	}).catch(function(err) {
		res.locals.userMessage = "Error loading help content: " + err;

		res.render("browser");
	});
});

router.get("/about", function(req, res) {
	res.render("about");
});

router.get("/fun", function(req, res) {
	res.locals.historicalData = rpcApi.getHistoricalData();
	
	res.render("fun");
});

module.exports = router;
