import { FileWorkflowStore } from "./accountStore.js";
const [dir, key, token] = process.argv.slice(2);
await new FileWorkflowStore(dir, key).update(token, async (state, save) => {
  state.submissionOutcome = "unknown";
  await save();
  setInterval(() => {}, 1000);
  process.send?.("checkpointed");
  await new Promise(() => {});
});
