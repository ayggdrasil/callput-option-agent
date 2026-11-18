/* All private-key operations stay in this browser; no analytics or console output. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id),
    token = location.hash.slice(1),
    providers = new Map();
  let current,
    provider,
    device,
    busy = false,
    invalidated = true,
    generation = 0;
  const fail = (code) => {
      throw Error(code);
    },
    assert = (ok, code) => {
      if (!ok) fail(code);
    };
  const api = async (operation, extra = {}) => {
    const r = await fetch("https://mcp.callput.app/api/wallet", {
      method: "POST",
      credentials: "omit",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation, workflow_id: token, ...extra }),
      signal: AbortSignal.timeout(25000),
    });
    const data = await r.json();
    assert(r.ok, data.blocked_reason ?? data.error ?? "request_unavailable");
    return data;
  };
  const message = (code) => {
    const known = {
      wallet_identity_changed:
        "Your wallet or network changed. Reconnect before approving.",
      wallet_domain_required:
        "Open the approval link for the selected CallPut network.",
      device_key_missing:
        "This browser no longer has the authorized trading key. Revoke the old session before authorizing another.",
      wallet_request_already_started:
        "This wallet request already started. Recover its original result; do not repeat a transfer.",
      owner_mismatch: "Connect the wallet address shown below.",
      wallet_rejected:
        "You declined this request. The agent will keep its original record.",
      workflow_unavailable:
        "This request is unavailable. Ask your agent to check its status.",
    };
    return (
      known[code] ??
      (/^[a-z0-9_]{1,100}$/.test(code)
        ? code.replaceAll("_", " ")
        : "Request did not complete. Check your wallet and ask your agent to observe the existing action.")
    );
  };
  async function db() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open("callput-mcp-wallet-v1", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("vault");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(Error("browser_storage_unavailable"));
    });
  }
  async function stored(id, value) {
    const d = await db();
    try {
      return await new Promise((resolve, reject) => {
        const tx = d.transaction(
            "vault",
            value === undefined ? "readonly" : "readwrite",
          ),
          store = tx.objectStore("vault"),
          r = value === undefined ? store.get(id) : store.put(value, id);
        let result;
        r.onsuccess = () => {
          result = r.result;
        };
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(Error("browser_storage_unavailable"));
      });
    } finally {
      d.close();
    }
  }
  const bytes = (x) => new TextEncoder().encode(x);
  async function vault(id, value) {
    const keyId = token + ":aes";
    let key = await stored(keyId);
    if (!key) {
      key = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
      await stored(keyId, key);
    }
    if (value !== undefined) {
      const iv = crypto.getRandomValues(new Uint8Array(12)),
        cipher = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv, additionalData: bytes(id) },
          key,
          bytes(JSON.stringify(value)),
        );
      await stored(token + ":" + id, { iv, cipher });
      return value;
    }
    const record = await stored(token + ":" + id);
    if (!record) return null;
    return JSON.parse(
      new TextDecoder().decode(
        await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: record.iv, additionalData: bytes(id) },
          key,
          record.cipher,
        ),
      ),
    );
  }
  async function tradingKey() {
    let saved = await vault("device");
    if (!saved) {
      assert(!current.device_signer, "device_key_missing");
      const w = ethers.Wallet.createRandom();
      saved = { privateKey: w.privateKey, address: w.address.toLowerCase() };
      await vault("device", saved);
    }
    const w = new ethers.Wallet(saved.privateKey);
    assert(
      !current.device_signer ||
        current.device_signer === w.address.toLowerCase(),
      "device_key_missing",
    );
    return w;
  }
  async function identity() {
    assert(provider && !invalidated, "wallet_identity_changed");
    const accounts = await provider.request({ method: "eth_accounts" }),
      chain = await provider.request({ method: "eth_chainId" });
    assert(
      accounts[0]?.toLowerCase() === current.owner &&
        Number(BigInt(chain)) === current.chain_id &&
        !invalidated,
      "wallet_identity_changed",
    );
  }
  function render(data) {
    current = data;
    const entries = [
      ["Network", data.network + " · " + data.chain_id],
      ["Owner wallet", data.owner],
      ["CallPut account", data.account],
      ["Trade", (data.policy.underlying_asset ?? "ETH") + " " +
        (data.policy.strategy ?? "BuyCallSpread")],
      [
        "Trading budget",
        Number(data.policy.max_user_amount_raw) / 1e6 + " collateral units",
      ],
      ["Status", data.state],
    ];
    const dl = $("identity");
    dl.replaceChildren();
    for (const [label, value] of entries) {
      const dt = document.createElement("dt"),
        dd = document.createElement("dd");
      dt.textContent = label;
      dd.textContent = value;
      dl.append(dt, dd);
    }
    const a = data.pending_action;
    $("review").hidden = !a;
    $("recovery").hidden = !(
      a?.step === "deposit" && a.action_state === "wallet_pending"
    );
    if (a) {
      $("action-title").textContent =
        a.step === "deposit"
          ? "Review deposit"
          : a.step === "register"
            ? "Review trading permission"
            : "Review " + a.step;
      $("summary").textContent = a.summary;
      $("details").textContent = JSON.stringify(a.wallet_request, null, 2);
      $("approve").disabled =
        busy || invalidated || a.action_state !== "prepared";
      $("retry").hidden = a.action_state !== "wallet_pending";
    }
    if (!busy)
      $("status").textContent =
        data.state === "trade_executed"
          ? "Your trade and position were verified."
          : a
            ? "Review the exact action before approving."
            : "Waiting for your agent’s next action.";
  }
  function addProvider(id, name, p) {
    if (!p || providers.has(id)) return;
    providers.set(id, p);
    const o = document.createElement("option");
    o.value = id;
    o.textContent = name;
    $("provider").append(o);
  }
  window.addEventListener("eip6963:announceProvider", (event) => {
    const d = event.detail;
    if (d?.info?.uuid && d.provider)
      addProvider(d.info.uuid, d.info.name, d.provider);
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  if (window.ethereum)
    addProvider("injected", "Browser wallet", window.ethereum);
  const run = (fn) => async () => {
    if (busy) return;
    busy = true;
    $("connect").disabled = true;
    $("approve").disabled = true;
    try {
      assert(
        navigator.locks && isSecureContext && window.top === window.self,
        "browser_unsupported",
      );
      await navigator.locks.request(
        "callput-mcp-wallet:" + token,
        { ifAvailable: true },
        async (lock) => {
          assert(lock, "wallet_busy");
          await fn();
        },
      );
    } catch (error) {
      $("status").textContent = message(
        error?.code === 4001
          ? "wallet_rejected"
          : (error?.message ?? "workflow_unavailable"),
      );
    } finally {
      busy = false;
      $("connect").disabled = false;
    }
  };
  $("connect").onclick = run(async () => {
    assert(/^[a-f0-9]{64}$/.test(token), "workflow_unavailable");
    current = await api("read");
    provider = providers.get($("provider").value);
    assert(provider, "wallet_unavailable");
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    assert(accounts[0]?.toLowerCase() === current.owner, "owner_mismatch");
    const hex = "0x" + current.chain_id.toString(16);
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hex }],
    });
    invalidated = false;
    generation++;
    await identity();
    device = await tradingKey();
    const changed = () => {
      generation++;
      invalidated = true;
      $("approve").disabled = true;
      $("status").textContent = message("wallet_identity_changed");
    };
    provider.on?.("accountsChanged", changed);
    provider.on?.("chainChanged", changed);
    await api("connect", {
      connection: {
        owner: current.owner,
        chain_id: current.chain_id,
        device_signer: device.address.toLowerCase(),
      },
    });
    render(await api("read"));
    $("status").textContent =
      "Wallet connected. Your agent can prepare the next action.";
  });
  $("approve").onclick = run(async () => {
    await identity();
    const before = generation,
      data = await api("read"),
      a = data.pending_action;
    assert(
      a && a.action_state === "prepared",
      "wallet_request_already_started",
    );
    current = data;
    assert(generation === before && !invalidated, "wallet_identity_changed");
    const cached = await vault("result:" + a.action_id);
    if (cached?.result) {
      await api("submit", { action_id: a.action_id, result: cached.result });
      render(await api("read"));
      return;
    }
    const started = await api("begin", { action_id: a.action_id });
    assert(
      started.wallet_request_may_execute,
      "wallet_request_already_started",
    );
    await vault("result:" + a.action_id, {
      state: "wallet_pending",
      step: a.step,
    });
    let result;
    if (!a.wallet_request) result = {};
    else if (a.wallet_request.method === "eth_sendTransaction") {
      const tx = a.wallet_request.params[0];
      assert(
        tx.from === data.owner &&
          Number(BigInt(tx.chainId)) === data.chain_id &&
          tx.value === "0x0",
        "invalid_deposit_request",
      );
      const iface = new ethers.Interface([
          "function transfer(address,uint256) returns(bool)",
        ]),
        decoded = iface.decodeFunctionData("transfer", tx.data);
      assert(
        decoded[0].toLowerCase() === data.account &&
          decoded[1] === BigInt(data.policy.deposit_amount_raw) &&
          BigInt(tx.gas) * BigInt(tx.gasPrice) <=
            BigInt(data.policy.max_deposit_gas_wei) &&
          tx.nonce !== undefined,
        "invalid_deposit_request",
      );
      const tokenAddress =
        data.network === "robinhood"
          ? "0x5fc5360d0400a0fd4f2af552add042d716f1d168"
          : "0x79ad98fa252d64a9095f83cc6faf4243e0d01d48";
      assert(tx.to === tokenAddress, "invalid_deposit_token");
      await identity();
      assert(generation === before, "wallet_identity_changed");
      result = { transaction_hash: await provider.request(a.wallet_request) };
    } else if (a.wallet_request.method === "personal_sign") {
      assert(a.wallet_request.params[1] === data.owner, "invalid_login_signer");
      await identity();
      result = { signature: await provider.request(a.wallet_request) };
    } else {
      assert(
        a.wallet_request.method === "eth_signTypedData_v4",
        "unsupported_signing_method",
      );
      const typed = JSON.parse(a.wallet_request.params[1]);
      const strategy = data.policy.strategy ?? "BuyCallSpread";
      const strategyBit = new Map([
        ["BuyCallSpread", "32"], ["SellCallSpread", "64"],
        ["BuyPutSpread", "128"], ["SellPutSpread", "256"],
      ]).get(strategy);
      const assetIndex = data.policy.underlying_asset_index ?? "2";
      assert(
        Number(typed.domain.chainId) === data.chain_id &&
          typed.domain.verifyingContract.toLowerCase() === data.account &&
          typed.domain.name === "CallPut Trading Account" &&
          typed.domain.version === "1" &&
          ethers.TypedDataEncoder.hash(
            typed.domain,
            typed.types,
            typed.message,
          ) === a.digest,
        "invalid_signature_domain_or_digest",
      );
      if (["Grant", "RevokeSession"].includes(typed.primaryType)) {
        assert(a.signer === data.owner, "invalid_owner_signer");
        if (typed.primaryType === "Grant")
          assert(
            typed.message.signer === device.address.toLowerCase() &&
              BigInt(typed.message.maxAmount) <=
                BigInt(data.policy.max_user_amount_raw) &&
              BigInt(typed.message.maxAmountPerOpen) <=
                BigInt(typed.message.maxAmount) &&
              BigInt(typed.message.validUntil) -
                BigInt(typed.message.validAfter) <=
                600n &&
              JSON.stringify(typed.message.underlyings) === JSON.stringify([assetIndex]) &&
              !!strategyBit && typed.message.strategies === strategyBit &&
              typed.message.maxCloses === "1" &&
              typed.message.maxOpens === "1",
            "invalid_grant_limits",
          );
        else
          assert(
            typed.message.sessionId === data.session?.id,
            "invalid_revocation_session",
          );
        await identity();
        result = { signature: await provider.request(a.wallet_request) };
      } else {
        assert(
          ["OpenIntent", "CloseIntent", "SponsoredSettlement"].includes(
            typed.primaryType,
          ) && a.signer === device.address.toLowerCase(),
          "invalid_device_signer",
        );
        if (typed.primaryType !== "SponsoredSettlement")
          assert(
            typed.message.sessionId === data.session?.id &&
              BigInt(typed.message.deadline) <=
                BigInt(data.session.valid_until),
            "invalid_order_session",
          );
        if (typed.primaryType === "OpenIntent") {
          const p = typed.message.params;
          const isBuy = strategy.startsWith("Buy"), isCall = strategy.includes("Call");
          assert(
            !!strategyBit && BigInt(p.amountIn) > 0n && BigInt(p.amountIn) <=
              BigInt(data.policy.max_user_amount_raw) &&
              BigInt(p.minSize) > 0n &&
              p.underlyingAssetIndex === assetIndex &&
              p.length === "2" &&
              JSON.stringify(p.isBuys) === JSON.stringify([isBuy, !isBuy, false, false]) &&
              JSON.stringify(p.isCalls) === JSON.stringify([isCall, isCall, false, false]),
            "invalid_order_limits",
          );
        }
        await identity();
        result = {
          signature: await device.signTypedData(
            typed.domain,
            typed.types,
            typed.message,
          ),
        };
      }
    }
    // Persist the original result even if the connector changed during the prompt.
    // A mined transfer must never become an invitation to send a replacement.
    await vault("result:" + a.action_id, {
      state: "returned",
      step: a.step,
      result,
    });
    await api("submit", { action_id: a.action_id, result });
    render(await api("read"));
    $("status").textContent =
      "Result received. Your agent will verify it before continuing.";
  });
  $("retry").onclick = run(async () => {
    await identity();
    const data = await api("read"),
      a = data.pending_action;
    assert(a, "workflow_unavailable");
    const record = await vault("result:" + a.action_id);
    if (record?.result)
      await api("submit", { action_id: a.action_id, result: record.result });
    else await api("retry_wallet", { action_id: a.action_id });
    render(await api("read"));
  });
  $("recover").onclick = run(async () => {
    const data = await api("read"),
      a = data.pending_action;
    assert(
      a?.step === "deposit" &&
        /^0x[0-9a-fA-F]{64}$/.test($("hash").value.trim()),
      "existing_transfer_hash_required",
    );
    const result = { transaction_hash: $("hash").value.trim() };
    await vault("result:" + a.action_id, {
      state: "returned",
      step: "deposit",
      result,
    });
    await api("submit", { action_id: a.action_id, result });
    render(await api("read"));
  });
  if (!/^[a-f0-9]{64}$/.test(token)) {
    $("status").textContent =
      "Open the wallet approval link returned by your agent.";
    $("connect").disabled = true;
    return;
  }
  api("read")
    .then(render)
    .catch((error) => {
      $("status").textContent = message(error.message);
    });
  setInterval(() => {
    if (!busy)
      api("read")
        .then(render)
        .catch(() => {});
  }, 5000);
})();
