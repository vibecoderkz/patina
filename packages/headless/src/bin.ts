import { main } from "./cli.js";

main(process.argv.slice(2)).catch((e: Error) => {
  console.error(`patina: ${e.message}`);
  process.exit(1);
});
