import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { InternalMcpTransportRegistry } from "./mcp-transport-registry";

/**
 * Sample in-memory MCP server that provides number-related tools
 */
export class SampleNumbersServer {
  private static readonly SERVER_ID = "sample-numbers";
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: "sample-numbers-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.setupHandlers();
  }

  /**
   * Initialize and register the in-memory server
   */
  public static async initialize(): Promise<void> {
    const serverInstance = new SampleNumbersServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    // Register the transport pair
    InternalMcpTransportRegistry.registerTransport(SampleNumbersServer.SERVER_ID, [
      clientTransport,
      serverTransport,
    ]);

    // Connect the server to its transport
    await serverInstance.server.connect(serverTransport);

    console.log(
      `[SampleNumbersServer] Initialized in-memory MCP server: ${SampleNumbersServer.SERVER_ID}`,
    );
  }

  private setupHandlers(): void {
    // Handle tool listing
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: this.getTools(),
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case "generate-random-numbers":
          return this.generateRandomNumbers(args);
        case "calculate-fibonacci":
          return this.calculateFibonacci(args);
        case "get-prime-numbers":
          return this.getPrimeNumbers(args);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  private getTools(): Tool[] {
    return [
      {
        name: "generate-random-numbers",
        description: "Generate a list of random numbers within a specified range",
        inputSchema: {
          type: "object",
          properties: {
            count: {
              type: "number",
              description: "Number of random numbers to generate",
              minimum: 1,
              maximum: 100,
            },
            min: {
              type: "number",
              description: "Minimum value (inclusive)",
              default: 0,
            },
            max: {
              type: "number",
              description: "Maximum value (inclusive)",
              default: 100,
            },
          },
          required: ["count"],
        },
      },
      {
        name: "calculate-fibonacci",
        description: "Calculate Fibonacci sequence up to n terms",
        inputSchema: {
          type: "object",
          properties: {
            terms: {
              type: "number",
              description: "Number of Fibonacci terms to calculate",
              minimum: 1,
              maximum: 50,
            },
          },
          required: ["terms"],
        },
      },
      {
        name: "get-prime-numbers",
        description: "Get all prime numbers up to a specified limit",
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Upper limit for prime number search",
              minimum: 2,
              maximum: 10000,
            },
          },
          required: ["limit"],
        },
      },
    ];
  }

  private generateRandomNumbers(args: any) {
    const count = args.count as number;
    const min = (args.min as number) ?? 0;
    const max = (args.max as number) ?? 100;

    const numbers: number[] = [];
    for (let i = 0; i < count; i++) {
      const randomNum = Math.floor(Math.random() * (max - min + 1)) + min;
      numbers.push(randomNum);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              count,
              range: { min, max },
              numbers,
              statistics: {
                average: numbers.reduce((a, b) => a + b, 0) / numbers.length,
                min: Math.min(...numbers),
                max: Math.max(...numbers),
              },
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private calculateFibonacci(args: any) {
    const terms = args.terms as number;
    const sequence: number[] = [];

    for (let i = 0; i < terms; i++) {
      if (i === 0 || i === 1) {
        sequence.push(i);
      } else {
        sequence.push(sequence[i - 1] + sequence[i - 2]);
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              terms,
              sequence,
              lastNumber: sequence[sequence.length - 1],
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private getPrimeNumbers(args: any) {
    const limit = args.limit as number;
    const primes: number[] = [];

    for (let num = 2; num <= limit; num++) {
      let isPrime = true;
      for (let i = 2; i <= Math.sqrt(num); i++) {
        if (num % i === 0) {
          isPrime = false;
          break;
        }
      }
      if (isPrime) {
        primes.push(num);
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              limit,
              count: primes.length,
              primes,
              largestPrime: primes[primes.length - 1],
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  public static getServerId(): string {
    return SampleNumbersServer.SERVER_ID;
  }
}
