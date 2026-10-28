import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
});

const client = new Client({ name: "agilepoint-apf-smoke", version: "0.1.0" });
await client.connect(transport);
const { tools } = await client.listTools();
console.log(tools.map((tool) => tool.name).sort().join("\n"));
await client.close();
