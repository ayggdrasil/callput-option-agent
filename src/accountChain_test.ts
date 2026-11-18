import { test } from "node:test";
import assert from "node:assert/strict";
import { Interface, TypedDataEncoder, Wallet } from "ethers";
import { AccountChain } from "./accountChain.js";
import { DEPLOYMENTS } from "./networkDeployments.js";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  accountDomain,
  accountTypes,
  accountManifest,
} from "./accountManifest.js";
test("sponsored close checks balance on the granted asset's options token", async () => {
  const balanceAbi = new Interface(["function balanceOf(address,uint256) view returns(uint256)"]);
  const account = Wallet.createRandom().address;
  const positionId = (3n << 240n) + 123n;
  const blockHash = "0x" + "a".repeat(64);
  class Fake extends AccountChain {
    override async use<T>(network: string, fn: (p: any) => Promise<T>) {
      assert.equal(network, "robinhood");
      return fn({
        send: async (method: string, [tx, block]: any[]) => {
          assert.equal(method, "eth_call");
          assert.equal(tx.to, DEPLOYMENTS.robinhood.underlyings.TSLA.optionsToken);
          assert.deepEqual([...balanceAbi.decodeFunctionData("balanceOf", tx.data)], [account, positionId]);
          assert.deepEqual(block, { blockHash, requireCanonical: true });
          return balanceAbi.encodeFunctionResult("balanceOf", [10n]);
        },
      });
    }
  }
  const chain = new Fake();
  const state = { network: "robinhood", account, context: { blockHash } };
  assert.equal(await chain.positionBalance(state, String(positionId)), "10");
  await assert.rejects(chain.positionBalance(state, String(65535n << 240n)), /account_underlying_unsupported/);
});
test("account RPC verification supports archive providers that reject JSON-RPC batches", async () => {
  let batches = 0;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    const reply = (x: any) => ({
      jsonrpc: "2.0",
      id: x.id,
      ...(Array.isArray(input)
        ? { error: { code: -32600, message: "Batch requests unsupported" } }
        : { result: x.method === "eth_chainId" ? "0x1237" : "0x" }),
    });
    if (Array.isArray(input)) batches++;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(Array.isArray(input) ? input.map(reply) : reply(input)),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const before = process.env.CALLPUT_ROBINHOOD_TRACKING_RPC_URL;
  process.env.CALLPUT_ROBINHOOD_TRACKING_RPC_URL = `http://127.0.0.1:${address.port}`;
  try {
    const result = await new AccountChain().use(
      "robinhood",
      (p) =>
        Promise.all([
          p.send("eth_getCode", ["0x" + "1".repeat(40), "latest"]),
          p.send("eth_getCode", ["0x" + "2".repeat(40), "latest"]),
        ]),
      true,
    );
    assert.deepEqual(result, ["0x", "0x"]);
    assert.equal(batches, 0);
  } finally {
    if (before === undefined)
      delete process.env.CALLPUT_ROBINHOOD_TRACKING_RPC_URL;
    else process.env.CALLPUT_ROBINHOOD_TRACKING_RPC_URL = before;
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test("Nitro deposit transaction fixes nonce and maximum gas cost before wallet approval", async () => {
  const balanceAbi = new Interface([
    "function balanceOf(address) view returns(uint256)",
    "function transfer(address,uint256) returns(bool)",
  ]);
  class Fake extends AccountChain {
    override async use<T>(_network: string, fn: (p: any) => Promise<T>) {
      return fn({
        estimateGas: async () => 100n,
        send: async (method: string, params: any[]) =>
          method === "eth_gasPrice"
            ? "0xa"
            : params[0].from
              ? balanceAbi.encodeFunctionResult("transfer", [true])
              : balanceAbi.encodeFunctionResult("balanceOf", [100000]),
        getBalance: async () => 2000n,
        getTransactionCount: async () => 7,
      });
    }
  }
  const chain = new Fake(),
    state = {
      network: "robinhood",
      owner: Wallet.createRandom().address,
      policy: { max_deposit_gas_wei: "1200", deposit_amount_raw: "100000" },
    };
  const tx = await chain.depositTransaction(state, "0x1234");
  assert.equal(BigInt(tx.gas) * BigInt(tx.gasPrice), 1200n);
  assert.equal(tx.nonce, "0x7");
  for (const key of ["chainId", "value", "gas", "gasPrice", "nonce"] as const)
    assert.match(
      tx[key],
      /^0x(?:0|[1-9a-f][0-9a-f]*)$/,
      "JSON-RPC quantities must not contain leading zeroes",
    );
  await assert.rejects(
    chain.depositTransaction(
      { ...state, policy: { ...state.policy, max_deposit_gas_wei: "1199" } },
      "0x1234",
    ),
    /gas_cap/,
  );
  await assert.rejects(
    chain.depositTransaction({ ...state, network: "giwa" }, "0x1234"),
    /total_fee_bound_unavailable/,
  );
});
test("deposit rejects a false-returning ERC20 transfer before wallet approval", async () => {
  const token = new Interface([
    "function balanceOf(address) view returns(uint256)",
    "function transfer(address,uint256) returns(bool)",
  ]);
  class FalseTransfer extends AccountChain {
    override async use<T>(_network: string, fn: (p: any) => Promise<T>) {
      return fn({
        estimateGas: async () => 100n,
        getBalance: async () => 2000n,
        getTransactionCount: async () => 7,
        send: async (method: string, params: any[]) =>
          method === "eth_gasPrice"
            ? "0xa"
            : params[0].from
              ? token.encodeFunctionResult("transfer", [false])
              : token.encodeFunctionResult("balanceOf", [100000]),
      });
    }
  }
  const state = {
    network: "robinhood",
    owner: Wallet.createRandom().address,
    policy: { max_deposit_gas_wei: "1200", deposit_amount_raw: "100000" },
  };
  await assert.rejects(
    new FalseTransfer().depositTransaction(
      state,
      token.encodeFunctionData("transfer", [
        Wallet.createRandom().address,
        100000,
      ]),
    ),
    /transfer_simulation/,
  );
});
test("sponsored receipt checks the mined block pins and matching account/manager intent", async () => {
  const m = accountManifest("robinhood"),
    account = Wallet.createRandom().address.toLowerCase(),
    owner = Wallet.createRandom().address.toLowerCase(),
    device = Wallet.createRandom(),
    sessionId = "0x" + "1".repeat(64),
    hash = "0x" + "2".repeat(64),
    blockHash = "0x" + "3".repeat(64);
  const grant = {
    signer: device.address,
    nonce: "0",
    epoch: "0",
    validAfter: "1",
    validUntil: "1000",
    underlyings: ["2"],
    strategies: "32",
    maxAmountPerOpen: "100000",
    maxAmount: "100000",
    maxOpens: "1",
    maxCloses: "1",
    maxFeePerTrade: "1000",
    maxFees: "2000",
  };
  const intent = {
      sessionId,
      epoch: "0",
      nonce: "0",
      deadline: "999",
      source: "0",
    },
    params = {
      underlyingAssetIndex: "2",
      length: "2",
      isBuys: [true, false, false, false],
      optionIds: Array(4).fill("0x" + "0".repeat(64)),
      isCalls: [true, true, false, false],
      minSize: "1",
      amountIn: "1000",
    };
  const domain = accountDomain(m.chainId, account),
    types = { Open: accountTypes.Open, OpenIntent: accountTypes.OpenIntent },
    message = { ...intent, params },
    signature = await device.signTypedData(domain, types, message),
    digest = TypedDataEncoder.hash(domain, types, message),
    requestKey = "0x" + "4".repeat(64);
  const grantTuple =
      "(address signer,uint256 nonce,uint256 epoch,uint48 validAfter,uint48 validUntil,uint16[] underlyings,uint16 strategies,uint256 maxAmountPerOpen,uint256 maxAmount,uint32 maxOpens,uint32 maxCloses,uint256 maxFeePerTrade,uint256 maxFees)",
    intentTuple =
      "(bytes32 sessionId,uint256 epoch,uint256 nonce,uint48 deadline,uint8 source)",
    openTuple =
      "(uint16 underlyingAssetIndex,uint8 length,bool[4] isBuys,bytes32[4] optionIds,bool[4] isCalls,uint256 minSize,uint256 amountIn)";
  const abi = new Interface([
    `function openWithSession(${grantTuple} grant,${intentTuple} intent,${openTuple} params,bytes signature) payable returns(bytes32)`,
    "event SessionRequest(bytes32 indexed sessionId,uint256 indexed nonce,bytes32 indexed digest,bytes32 requestKey,bool isOpen,uint256 executionFee)",
    "event GenerateRequestKey(address indexed account,bytes32 indexed key,bool indexed isOpen)",
  ]);
  const log = (name: string, args: any[], address: string) => ({
    address,
    ...abi.encodeEventLog(abi.getEvent(name)!, args),
  });
  let tx: any = {
    hash,
    chainId: 4663n,
    to: account,
    from: m.sponsors[0],
    value: 100n,
    data: abi.encodeFunctionData("openWithSession", [
      grant,
      intent,
      params,
      signature,
    ]),
  };
  const receipt: any = {
    hash,
    status: 1,
    blockNumber: 123,
    blockHash,
    logs: [
      log(
        "SessionRequest",
        [sessionId, 0, digest, requestKey, true, 100],
        account,
      ),
      log("GenerateRequestKey", [account, requestKey, true], m.positionManager),
    ],
  };
  class Fake extends AccountChain {
    atBlock: number | undefined;
    override async use<T>(_network: string, fn: (p: any) => Promise<T>) {
      return fn({
        getTransaction: async () => tx,
        getTransactionReceipt: async () => receipt,
        getBlock: async () => ({ hash: blockHash }),
      });
    }
    override async resolve(
      _n: string,
      _o: string,
      _i?: string,
      _a?: string,
      _s?: string,
      atBlock?: number,
    ): Promise<any> {
      this.atBlock = atBlock;
      assert.equal(atBlock, 123);
      return { blockHash };
    }
  }
  const chain = new Fake(),
    state = {
      network: "robinhood",
      owner,
      account,
      sub_index: "0",
      sessionId,
      grant,
    },
    action = { step: "open", digest, envelope: { intent, params, signature } };
  assert.equal(
    (await chain.requestProof(state, action, hash))!.request_key,
    requestKey,
  );
  assert.equal(chain.atBlock, 123);
  tx = { ...tx, to: m.positionManager };
  await assert.rejects(
    chain.requestProof(state, action, hash),
    /intent_mismatch/,
  );
});
