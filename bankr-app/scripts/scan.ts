const result = await http.fetch("https://mcp.callput.app/api/bankr/scan", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    underlying_asset: String(args.underlying_asset || "TSLA"),
    bias: String(args.bias || "bullish"),
    max_results: Number(args.max_results || 3)
  })
});
return result;
