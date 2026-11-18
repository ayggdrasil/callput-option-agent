import {
  FetchRequest,
  JsonRpcProvider,
  Interface,
  keccak256,
  getAddress,
  toQuantity,
} from "ethers";
import {
  accountManifest,
  accountDomain,
  accountTypes,
  predictedAccount,
} from "./accountManifest.js";
import {
  resolveRpcUrl,
  resolveTrackingRpcUrl,
  getNetworkConfig,
  POSITION_MANAGER_ABI,
} from "./config.js";
const abi = new Interface([
  "function INITCODE_HASH() view returns(bytes32)",
  "function BEACON() view returns(address)",
  "function implementation() view returns(address)",
  "function legacyFactory() view returns(address)",
  "function computeAddress(address,uint96) view returns(address)",
  "function decimals() view returns(uint8)",
  "function transfer(address,uint256) returns(bool)",
  "function isCreated(address) view returns(bool)",
  "function accountInfo(address) view returns(address,uint96)",
  "function owner() view returns(address)",
  "function subIndex() view returns(uint96)",
  "function FACTORY() view returns(address)",
  "function version() view returns(uint256)",
  "function epoch() view returns(uint256)",
  "function balanceOf(address) view returns(uint256)",
  "function sessionState(bytes32) view returns((bool installed,bool revoked,uint32 opens,uint32 closes,uint256 amountSpent,uint256 feesSpent))",
  "function sessionNonceUsed(bytes32,uint256) view returns(bool)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
  "event OwnerAuthorizationUsed(uint256 indexed epoch,uint256 indexed nonce,bytes32 indexed digest)",
  "function withdrawBySignature((uint8 kind,address token,uint256 id,uint256 amount,address to,uint256 epoch,uint256 nonce,uint48 deadline),bytes signature)",
  "event SessionRequest(bytes32 indexed sessionId,uint256 indexed nonce,bytes32 indexed digest,bytes32 requestKey,bool isOpen,uint256 executionFee)",
  "event GenerateRequestKey(address indexed account,bytes32 indexed key,bool indexed isOpen)",
]);
const positionManagerAbi = new Interface(POSITION_MANAGER_ABI);
const ensure = (ok: unknown, code: string) => {
  if (!ok) throw Error(code);
};
export class AccountChain {
  async use<T>(
    network: string,
    fn: (p: JsonRpcProvider) => Promise<T>,
    historical = false,
  ) {
    const m = accountManifest(network),
      request = new FetchRequest(
        historical
          ? resolveTrackingRpcUrl(process.env, m.network)
          : resolveRpcUrl(process.env, m.network),
      );
    request.timeout = 12000;
    // Public archive providers may reject JSON-RPC batch arrays even though
    // each method is supported. Keep proof calls interoperable and individually bounded.
    const p = new JsonRpcProvider(request, undefined, { batchMaxCount: 1 });
    try {
      ensure(
        BigInt(await p.send("eth_chainId", [])) === BigInt(m.chainId),
        "wrong_chain",
      );
      return await fn(p);
    } finally {
      p.destroy();
    }
  }
  async resolve(
    network: string,
    ownerInput: string,
    index = "0",
    selected?: string,
    sessionId?: string,
    atBlock?: number,
  ) {
    const m = accountManifest(network),
      owner = getAddress(ownerInput).toLowerCase();
    ensure(
      /^(0|[1-9][0-9]*)$/.test(index) &&
        BigInt(index) < BigInt(m.maxSubAccounts),
      "invalid_sub_index",
    );
    return this.use(
      network,
      async (p) => {
        const b = await p.getBlock(atBlock ?? "latest");
        ensure(
          b?.hash &&
            (atBlock !== undefined ||
              Math.abs(Date.now() / 1000 - b.timestamp) < 90),
          "stale_account_context",
        );
        const tag = { blockHash: b!.hash, requireCanonical: true };
        const read = async (to: string, name: string, args: any[] = []) =>
          abi.decodeFunctionResult(
            name,
            await p.send("eth_call", [
              { to, data: abi.encodeFunctionData(name, args) },
              tag,
            ]),
          );
        const code = async (a: string) =>
          p.send("eth_getCode", [a, tag]) as Promise<string>;
        const ownerCode = await code(owner);
        ensure(
          ownerCode === "0x" || /^0xef0100[0-9a-f]{40}$/i.test(ownerCode),
          "unsupported_owner_wallet",
        );
        const origin = m.origins[0];
        ensure(
          keccak256(await code(origin.factory)) === origin.codeHash,
          "factory_pin_mismatch",
        );
        if (m.factoryImplementationHash) {
          const slot =
              "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
            word = await p.send("eth_getStorageAt", [
              origin.factory,
              slot,
              tag,
            ]);
          ensure(
            /^0x0{24}[0-9a-f]{40}$/i.test(word) && BigInt(word) !== 0n,
            "factory_proxy_slot_mismatch",
          );
          ensure(
            keccak256(await code("0x" + word.slice(-40))) ===
              m.factoryImplementationHash,
            "factory_implementation_pin_mismatch",
          );
          const [legacy] = await read(origin.factory, "legacyFactory");
          ensure(
            legacy.toLowerCase() === m.origins[1].factory,
            "factory_migration_origin_mismatch",
          );
        }
        const [beacon] = await read(origin.factory, "BEACON"),
          [implementation] = await read(beacon, "implementation");
        ensure(
          keccak256(await code(implementation)) === m.implementationHash,
          "implementation_pin_mismatch",
        );
        const candidates = [];
        for (const o of m.origins) {
          ensure(
            keccak256(await code(o.factory)) === o.codeHash,
            "factory_origin_pin_mismatch",
          );
          const [hash] = await read(o.factory, "INITCODE_HASH");
          ensure(hash === o.initCodeHash, "init_code_pin_mismatch");
          const account = predictedAccount(o, owner, index),
            [created] = await read(o.factory, "isCreated", [account]);
          candidates.push({ account, created, origin: o.factory });
        }
        let choice = selected
          ? candidates.find(
              (c) => c.account === getAddress(selected).toLowerCase(),
            )
          : (candidates.find((c) => c.created) ?? candidates[0]);
        ensure(choice, "account_origin_mismatch");
        const account = choice!.account;
        const [computed] = await read(origin.factory, "computeAddress", [
          owner,
          index,
        ]);
        ensure(
          computed.toLowerCase() === account,
          "factory_account_resolution_mismatch",
        );
        let epoch = "0",
          sessions: any[] = [];
        if (choice!.created) {
          const [info, aOwner, aIndex, factory, version, aEpoch] =
            await Promise.all([
              read(choice!.origin, "accountInfo", [account]),
              read(account, "owner"),
              read(account, "subIndex"),
              read(account, "FACTORY"),
              read(account, "version"),
              read(account, "epoch"),
            ]);
          ensure(
            info[0].toLowerCase() === owner &&
              info[1] === BigInt(index) &&
              aOwner[0].toLowerCase() === owner &&
              aIndex[0] === BigInt(index) &&
              factory[0].toLowerCase() === origin.factory &&
              version[0] === 6n &&
              (await code(account)) !== "0x",
            "account_ownership_mismatch",
          );
          epoch = aEpoch[0].toString();
          if (sessionId) {
            const [s] = await read(account, "sessionState", [sessionId]);
            sessions = [
              {
                sessionId,
                installed: s.installed,
                revoked: s.revoked,
                ...Object.fromEntries(
                  ["opens", "closes", "amountSpent", "feesSpent"].map((k) => [
                    k,
                    s[k].toString(),
                  ]),
                ),
              },
            ];
          }
        } else
          ensure((await code(account)) === "0x", "unexpected_account_code");
        const [[balance], [decimals]] = await Promise.all([
          read(m.token, "balanceOf", [account]),
          read(m.token, "decimals"),
        ]);
        ensure(decimals === 6n, "collateral_decimals_mismatch");
        ensure(
          (await p.getBlock(b!.number))?.hash === b!.hash,
          "canonical_block_changed",
        );
        return {
          owner,
          account,
          subIndex: index,
          created: !!choice!.created,
          balance: balance.toString(),
          epoch,
          sessions,
          blockNumber: String(b!.number),
          blockHash: b!.hash,
          blockTimestamp: String(b!.timestamp),
          factory: origin.factory,
          accountOrigin: choice!.origin,
          implementation: implementation.toLowerCase(),
          implementationHash: m.implementationHash,
          policyVersion: m.version,
        };
      },
      atBlock !== undefined,
    );
  }
  async depositTransaction(state: any, data: string) {
    return this.use(state.network, async (p) => {
      const m = accountManifest(state.network);
      // OP L1 data fees have no transaction-level upper bound. Do not promise a
      // total native cap that an EOA transaction cannot enforce.
      ensure(m.chainId === 4663, "deposit_total_fee_bound_unavailable");
      const [estimate, price, balance, native, nonce, simulation] =
        await Promise.all([
          p.estimateGas({ from: state.owner, to: m.token, data, value: 0n }),
          p.send("eth_gasPrice", []),
          p.send("eth_call", [
            {
              to: m.token,
              data: abi.encodeFunctionData("balanceOf", [state.owner]),
            },
            "latest",
          ]),
          p.getBalance(state.owner),
          p.getTransactionCount(state.owner, "pending"),
          p.send("eth_call", [
            { from: state.owner, to: m.token, data, value: "0x0" },
            "latest",
          ]),
        ]);
      const gas = (estimate * 120n + 99n) / 100n,
        gasPrice = BigInt(price),
        maximum = gas * gasPrice;
      ensure(
        maximum <= BigInt(state.policy.max_deposit_gas_wei) &&
          native >= maximum,
        "deposit_gas_cap_or_balance_insufficient",
      );
      ensure(
        abi.decodeFunctionResult("balanceOf", balance)[0] >=
          BigInt(state.policy.deposit_amount_raw),
        "owner_collateral_insufficient",
      );
      ensure(
        abi.decodeFunctionResult("transfer", simulation)[0] === true,
        "deposit_transfer_simulation_failed",
      );
      return {
        from: state.owner,
        to: m.token,
        value: "0x0",
        chainId: toQuantity(m.chainId),
        data,
        gas: toQuantity(gas),
        gasPrice: toQuantity(gasPrice),
        nonce: toQuantity(nonce),
      };
    });
  }
  async deposit(state: any, action: any, hash: string) {
    return this.use(state.network, async (p) => {
      const [tx, r] = await Promise.all([
        p.getTransaction(hash),
        p.getTransactionReceipt(hash),
      ]);
      if (!tx || !r) return { confirmed: false };
      const m = accountManifest(state.network),
        expected = action.wallet_request.params[0];
      ensure(r.status === 1, "deposit_reverted");
      ensure(
        tx.chainId === BigInt(m.chainId) &&
          tx.from.toLowerCase() === state.owner &&
          tx.to?.toLowerCase() === m.token &&
          tx.data.toLowerCase() === expected.data.toLowerCase() &&
          tx.value === 0n &&
          r.hash.toLowerCase() === hash.toLowerCase(),
        "deposit_intent_mismatch",
      );
      ensure(
        tx.nonce === Number(BigInt(expected.nonce)) &&
          tx.gasLimit <= BigInt(expected.gas) &&
          (tx.maxFeePerGas ?? tx.gasPrice ?? 0n) <= BigInt(expected.gasPrice),
        "deposit_wallet_changed_fee_or_nonce",
      );
      ensure(
        BigInt(r.gasUsed) * BigInt(r.gasPrice) <=
          BigInt(state.policy.max_deposit_gas_wei),
        "deposit_gas_budget_exceeded",
      );
      const events = r.logs
        .filter((l) => l.address.toLowerCase() === m.token)
        .flatMap((l) => {
          try {
            const e = abi.parseLog(l);
            return e?.name === "Transfer" &&
              e.args.from.toLowerCase() === state.owner &&
              e.args.to.toLowerCase() === state.account &&
              e.args.value === BigInt(state.policy.deposit_amount_raw)
              ? [e]
              : [];
          } catch {
            return [];
          }
        });
      ensure(
        events.length === 1 &&
          (await p.getBlock(r.blockNumber))?.hash === r.blockHash,
        "deposit_evidence_mismatch",
      );
      const context = await this.resolve(
        state.network,
        state.owner,
        state.sub_index,
        state.account,
        undefined,
        r.blockNumber,
      );
      ensure(
        context.blockHash === r.blockHash,
        "deposit_account_context_mismatch",
      );
      return {
        confirmed: true,
        hash,
        blockNumber: r.blockNumber,
        blockHash: r.blockHash,
        amount_raw: state.policy.deposit_amount_raw,
        gas_paid_wei: (r.gasUsed * r.gasPrice).toString(),
      };
    });
  }
  async sessionNonce(state: any, nonce: string) {
    return this.use(state.network, async (p) => {
      const raw = await p.send("eth_call", [
        {
          to: state.account,
          data: abi.encodeFunctionData("sessionNonceUsed", [
            state.sessionId,
            nonce,
          ]),
        },
        "latest",
      ]);
      return abi.decodeFunctionResult("sessionNonceUsed", raw)[0] as boolean;
    });
  }
  async positionBalance(state: any, id: string) {
    return this.use(state.network, async (p) => {
      const assetIndex = Number(BigInt(id) >> 240n);
      const asset = Object.values(getNetworkConfig(accountManifest(state.network).network).UNDERLYINGS)
        .find((entry) => entry.index === assetIndex);
      if (!asset?.optionsToken) throw Error("account_underlying_unsupported");
      const iface = new Interface([
          "function balanceOf(address,uint256) view returns(uint256)",
        ]),
        raw = await p.send("eth_call", [
          {
            to: asset.optionsToken,
            data: iface.encodeFunctionData("balanceOf", [state.account, id]),
          },
          { blockHash: state.context.blockHash, requireCanonical: true },
        ]);
      return iface
        .decodeFunctionResult("balanceOf", raw)[0]
        .toString() as string;
    });
  }
  async expiredProof(state: any, orders: { nonce: string; deadline: string }[] = []) {
    return this.use(
      state.network,
      async (p) => {
        const block = await p.getBlock("finalized");
        ensure(
          block?.hash &&
            BigInt(block.timestamp) > BigInt(state.grant.validUntil),
          "session_not_finalized_expired",
        );
        const context = await this.resolve(
          state.network,
          state.owner,
          state.sub_index,
          state.account,
          state.sessionId,
          block!.number,
        );
        const selected = context.sessions.find(
          (s) => s.sessionId === state.sessionId,
        );
        ensure(
          context.blockHash === block!.hash &&
            selected &&
            ["opens", "closes", "amountSpent", "feesSpent"].every(
              (k) => selected[k] === "0",
            ),
          "session_used_budget_remains_reserved",
        );
        const tag = { blockHash: block!.hash, requireCanonical: true };
        const order_nonces = [];
        for (const { nonce, deadline } of orders) {
          ensure(BigInt(block!.timestamp) > BigInt(deadline), "order_not_finalized_expired");
          const raw = await p.send("eth_call", [{
            to: state.account,
            data: abi.encodeFunctionData("sessionNonceUsed", [state.sessionId, nonce]),
          }, tag]);
          const [used] = abi.decodeFunctionResult("sessionNonceUsed", raw);
          ensure(used === false, "signed_order_nonce_used");
          order_nonces.push({ nonce, used: false });
        }
        ensure((await p.getBlock(block!.number))?.hash === block!.hash,
          "canonical_block_changed");
        return {
          kind: "finalized_unused_expired",
          block_hash: block!.hash,
          block_number: block!.number,
          session_id: state.sessionId,
          grant_id: state.grantId,
          valid_until: state.grant.validUntil,
          counters: selected,
          order_nonces,
        };
      },
      true,
    );
  }
  async finalizedFill(state: any, requestKey: string, isOpen: boolean) {
    return this.use(state.network, async (p) => {
      const block = await p.getBlock("finalized");
      ensure(block?.hash, "finalized_keeper_state_unavailable");
      const method = isOpen ? "openPositionRequests" : "closePositionRequests";
      const result = positionManagerAbi.decodeFunctionResult(method, await p.send("eth_call", [
        {
          to: accountManifest(state.network).positionManager,
          data: positionManagerAbi.encodeFunctionData(method, [requestKey]),
        },
        { blockHash: block!.hash, requireCanonical: true },
      ]));
      const account = result.account.toLowerCase();
      const status = account === "0x" + "0".repeat(40) ? "not_found"
        : result.status === 2n ? "executed" : result.status === 1n ? "cancelled" : "pending";
      return {
        request_key: requestKey, account, status,
        block_number: block!.number, block_hash: block!.hash,
        ...(isOpen ? { size_out: result.sizeOut.toString() } : { amount_out: result.amountOut.toString() }),
        execution_price: result.executionPrice.toString(),
      };
    }, true);
  }
  async withdrawalProof(state: any, action: any, hash: string) {
    return this.use(state.network, async (p) => {
      const m = accountManifest(state.network);
      const [tx, receipt, finalized] = await Promise.all([
        p.getTransaction(hash), p.getTransactionReceipt(hash), p.getBlock("finalized"),
      ]);
      if (!tx || !receipt || !finalized || receipt.blockNumber > finalized.number) return null;
      const { params, signature } = action.envelope;
      ensure(receipt.status === 1 && tx.chainId === BigInt(m.chainId) &&
        tx.to?.toLowerCase() === state.account && tx.value === 0n &&
        m.sponsors.includes(tx.from.toLowerCase()) &&
        tx.data.toLowerCase() === abi.encodeFunctionData("withdrawBySignature", [params, signature]).toLowerCase(),
        "withdrawal_receipt_intent_mismatch");
      const matching = (address: string, predicate: (log: NonNullable<ReturnType<Interface["parseLog"]>>) => boolean) =>
        receipt.logs.filter(l => l.address.toLowerCase() === address).filter(l => {
          try { const parsed = abi.parseLog(l); return !!parsed && predicate(parsed); }
          catch { return false; }
        });
      ensure(matching(state.account, e => e.name === "OwnerAuthorizationUsed" &&
        e.args.epoch === BigInt(params.epoch) && e.args.nonce === BigInt(params.nonce) &&
        e.args.digest === action.digest).length === 1 &&
        matching(m.token, e => e.name === "Transfer" && e.args.from.toLowerCase() === state.account &&
          e.args.to.toLowerCase() === params.to && e.args.value === BigInt(params.amount)).length === 1 &&
        (await p.getBlock(receipt.blockNumber))?.hash === receipt.blockHash,
        "withdrawal_evidence_mismatch");
      return { transaction_hash: hash, block_number: receipt.blockNumber, block_hash: receipt.blockHash,
        amount_raw: params.amount, token: params.token, recipient: params.to };
    }, true);
  }
  async settlementProof(state: any, action: any, hash: string) {
    return this.use(
      state.network,
      async (p) => {
        const m = accountManifest(state.network),
          [tx, r, finalized] = await Promise.all([
            p.getTransaction(hash),
            p.getTransactionReceipt(hash),
            p.getBlock("finalized"),
          ]);
        if (!tx || !r || !finalized || r.blockNumber > finalized.number) return null;
        const settle = new Interface([
          "function settleExpired(uint256[] optionTokenIds)",
          "event SettlePosition(address indexed account,uint16 indexed underlyingAssetIndex,uint40 indexed expiry,uint256 optionTokenId,uint256 size,address[] path,uint256 amountOut,uint256 settlePrice)",
        ]);
        ensure(
          r.status === 1 &&
            tx.chainId === BigInt(m.chainId) &&
            tx.to?.toLowerCase() === state.account &&
            tx.value === 0n &&
            m.sponsors.includes(tx.from.toLowerCase()) &&
            tx.data.toLowerCase() ===
              settle
                .encodeFunctionData("settleExpired", [
                  [action.input.option_token_id],
                ])
                .toLowerCase(),
          "settlement_intent_mismatch",
        );
        const manager = getNetworkConfig(
            m.network,
          ).CONTRACTS.SETTLE_MANAGER.toLowerCase(),
          events = r.logs
            .filter((l) => l.address.toLowerCase() === manager)
            .flatMap((l) => {
              try {
                const e = settle.parseLog(l);
                return e?.name === "SettlePosition" &&
                  e.args.account.toLowerCase() === state.account &&
                  e.args.optionTokenId ===
                    BigInt(action.input.option_token_id) &&
                  e.args.size > 0n
                  ? [e]
                  : [];
              } catch {
                return [];
              }
            });
        ensure(
          events.length === 1 &&
            (await p.getBlock(r.blockNumber))?.hash === r.blockHash,
          "settlement_evidence_mismatch",
        );
        const context = await this.resolve(
          state.network,
          state.owner,
          state.sub_index,
          state.account,
          state.sessionId,
          r.blockNumber,
        );
        ensure(
          context.blockHash === r.blockHash,
          "settlement_context_mismatch",
        );
        return {
          transaction_hash: hash,
          block_hash: r.blockHash,
          option_token_id: action.input.option_token_id,
          size: events[0].args.size.toString(),
          amount_out: events[0].args.amountOut.toString(),
        };
      },
      true,
    );
  }
  async requestProof(state: any, action: any, hash: string) {
    return this.use(
      state.network,
      async (p) => {
        const m = accountManifest(state.network),
          [tx, r] = await Promise.all([
            p.getTransaction(hash),
            p.getTransactionReceipt(hash),
          ]);
        if (!tx || !r) return null;
        const method =
            action.step === "open" ? "openWithSession" : "closeWithSession",
          param =
            action.step === "open"
              ? "(uint16 underlyingAssetIndex,uint8 length,bool[4] isBuys,bytes32[4] optionIds,bool[4] isCalls,uint256 minSize,uint256 amountIn)"
              : "(uint16 underlyingAssetIndex,uint256 optionTokenId,uint256 size,uint256 minAmountOut)";
        const grant =
            "(address signer,uint256 nonce,uint256 epoch,uint48 validAfter,uint48 validUntil,uint16[] underlyings,uint16 strategies,uint256 maxAmountPerOpen,uint256 maxAmount,uint32 maxOpens,uint32 maxCloses,uint256 maxFeePerTrade,uint256 maxFees)",
          intent =
            "(bytes32 sessionId,uint256 epoch,uint256 nonce,uint48 deadline,uint8 source)";
        const call = new Interface([
          `function ${method}(${grant} grant,${intent} intent,${param} params,bytes signature) payable returns(bytes32)`,
        ]);
        const e = action.envelope;
        ensure(
          r.status === 1 &&
            tx.chainId === BigInt(m.chainId) &&
            tx.to?.toLowerCase() === state.account &&
            m.sponsors.includes(tx.from.toLowerCase()) &&
            tx.value <= BigInt(state.grant.maxFeePerTrade) &&
            tx.data.toLowerCase() ===
              call
                .encodeFunctionData(method, [
                  state.grant,
                  e.intent,
                  e.params,
                  e.signature,
                ])
                .toLowerCase(),
          "sponsored_receipt_intent_mismatch",
        );
        const digest = action.digest,
          isOpen = action.step === "open",
          events = r.logs
            .filter((l) => l.address.toLowerCase() === state.account)
            .flatMap((l) => {
              try {
                const x = abi.parseLog(l);
                return x?.name === "SessionRequest" &&
                  x.args.sessionId === state.sessionId &&
                  x.args.nonce === BigInt(e.intent.nonce) &&
                  x.args.digest === digest &&
                  x.args.isOpen === isOpen &&
                  x.args.executionFee === tx.value
                  ? [x.args.requestKey]
                  : [];
              } catch {
                return [];
              }
            });
        const generated = r.logs
          .filter((l) => l.address.toLowerCase() === m.positionManager)
          .flatMap((l) => {
            try {
              const x = abi.parseLog(l);
              return x?.name === "GenerateRequestKey" &&
                x.args.account.toLowerCase() === state.account &&
                x.args.isOpen === isOpen
                ? [x.args.key]
                : [];
            } catch {
              return [];
            }
          });
        ensure(
          events.length === 1 &&
            generated.length === 1 &&
            events[0] === generated[0] &&
            (await p.getBlock(r.blockNumber))?.hash === r.blockHash,
          "sponsored_event_mismatch",
        );
        // Re-observe current pinned code/owner, independently from the relay's claim.
        const historical = await this.resolve(
          state.network,
          state.owner,
          state.sub_index,
          state.account,
          state.sessionId,
          r.blockNumber,
        );
        ensure(
          historical.blockHash === r.blockHash,
          "receipt_canonical_context_mismatch",
        );
        return {
          request_key: events[0],
          transaction_hash: hash,
          block_number: r.blockNumber,
          block_hash: r.blockHash,
          is_open: isOpen,
          account: state.account,
          native_payer: tx.from.toLowerCase(),
          native_value_wei: tx.value.toString(),
          intent_digest: digest,
        };
      },
      true,
    );
  }
}
