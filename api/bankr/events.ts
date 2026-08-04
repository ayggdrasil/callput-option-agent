import { handleBankrApiRequest } from "../../src/bankrApi.js";
import { runVercelHandler } from "../../src/vercelAdapter.js";
export default async function handler(req: any, res: any) {
  await runVercelHandler(req, res, (request) => handleBankrApiRequest("events", request));
}
