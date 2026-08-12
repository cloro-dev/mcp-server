import { config } from "./config";
import { runHttpServer } from "./http";
import { runStdioServer } from "./stdio";

async function main(): Promise<void> {
  const { transport } = config;
  if (transport === "stdio") {
    await runStdioServer();
  } else if (transport === "http") {
    runHttpServer();
  } else {
    process.stderr.write(
      `Unknown MCP_TRANSPORT "${transport}" — expected "http" or "stdio".\n`,
    );
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`Failed to start cloro MCP server: ${error}\n`);
  process.exit(1);
});
