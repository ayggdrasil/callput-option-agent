import { handleWalletRequest } from "../src/accountTools.js";
import { runVercelHandler } from "../src/vercelAdapter.js";
export default async function handler(req: any, res: any) {
  await runVercelHandler(req, res, handleWalletRequest);
}
