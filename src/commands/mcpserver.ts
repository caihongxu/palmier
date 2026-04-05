import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { StringCodec } from "nats";
import { loadConfig } from "../config.js";
import { connectNats } from "../nats-client.js";
import { getTaskDir, parseTaskFile } from "../task.js";
import { requestUserInput, publishInputResolved } from "../user-input.js";
export async function mcpserverCommand(): Promise<void> {
  const config = loadConfig();
  const nc = await connectNats(config);

  const sc = StringCodec();

  const server = new McpServer(
    { name: "palmier", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  // send-push-notification requires NATS — only register when server mode is enabled
  if (nc) {
    server.registerTool(
      "send-push-notification",
      {
        description: "Send a push notification to the user",
        inputSchema: {
          title: z.string().describe("Notification title"),
          body: z.string().describe("Notification body text"),
        },
      },
      async (args) => {
        const payload = {
          hostId: config.hostId,
          title: args.title,
          body: args.body,
        };

        try {
          const subject = `host.${config.hostId}.push.send`;
          const reply = await nc!.request(subject, sc.encode(JSON.stringify(payload)), {
            timeout: 15_000,
          });
          const result = JSON.parse(sc.decode(reply.data)) as {
            ok?: boolean;
            error?: string;
          };

          if (result.ok) {
            return {
              content: [{ type: "text" as const, text: "Push notification sent successfully" }],
            };
          } else {
            return {
              content: [{ type: "text" as const, text: `Failed to send push notification: ${result.error}` }],
              isError: true,
            };
          }
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error sending push notification: ${err}` }],
            isError: true,
          };
        }
      }
    );
  }

  const taskId = process.env.PALMIER_TASK_ID;
  if (taskId) {
    const taskDir = getTaskDir(config.projectRoot, taskId);
    const task = parseTaskFile(taskDir);

    server.registerTool(
      "request-user-input",
      {
        description: "Request input from the user. The user will see the descriptions and can provide values or abort.",
        inputSchema: {
          descriptions: z.array(z.string()).describe("List of input descriptions to show the user"),
        },
      },
      async (args) => {
        try {
          const response = await requestUserInput(nc, config, taskId, task.frontmatter.name, taskDir, args.descriptions);
          await publishInputResolved(nc, config, taskId, response === "aborted" ? "aborted" : "provided");

          if (response === "aborted") {
            return {
              content: [{ type: "text" as const, text: "User aborted the input request." }],
            };
          }

          const lines = args.descriptions.map((desc: string, i: number) => `${desc}: ${response[i]}`).join("\n");
          return {
            content: [{ type: "text" as const, text: lines }],
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error requesting user input: ${err}` }],
            isError: true,
          };
        }
      }
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown
  transport.onclose = async () => {
    if (nc) await nc.drain();
  };
}
