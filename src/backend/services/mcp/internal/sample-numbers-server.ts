import { randomUUID } from "node:crypto";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MCPServerConfig } from "../types.js";
import type { InternalMcpServerRegistration } from "./internal-server-types.js";

const generateRandomNumbersInputShape = {
  count: z.number().min(1).max(100).describe("Number of random numbers to generate"),
  min: z.number().optional().default(0).describe("Minimum value (inclusive)"),
  max: z.number().optional().default(100).describe("Maximum value (inclusive)"),
};
const generateRandomNumbersSchema = z.object(generateRandomNumbersInputShape);

const calculateFibonacciInputShape = {
  terms: z.number().min(1).max(50).describe("Number of Fibonacci terms to calculate"),
};
const calculateFibonacciSchema = z.object(calculateFibonacciInputShape);

const getPrimeNumbersInputShape = {
  limit: z.number().min(2).max(10000).describe("Upper limit for prime number search"),
};
const getPrimeNumbersSchema = z.object(getPrimeNumbersInputShape);

/**
 * Create and initialize the sample numbers in-memory MCP server
 */
export async function createInternalSampleNumbersServer(): Promise<InternalMcpServerRegistration> {
  const serverId = `sample-numbers-${randomUUID()}`;

  const mcpServer = new McpServer({
    name: "Sample Numbers",
    version: "1.0.0",
    instructions: "Built-in sample MCP server demonstrating number-related tools.",
  });

  mcpServer.registerTool(
    "generate_random_numbers",
    {
      description: "Generate a list of random numbers within a specified range.",
      inputSchema: generateRandomNumbersInputShape,
    },
    async (input) => {
      const { count, min, max } = generateRandomNumbersSchema.parse(input);
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
                  average: numbers.reduce((a: number, b: number) => a + b, 0) / numbers.length,
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
    },
  );

  mcpServer.registerTool(
    "calculate_fibonacci",
    {
      description: "Calculate Fibonacci sequence up to n terms.",
      inputSchema: calculateFibonacciInputShape,
    },
    async (input) => {
      const { terms } = calculateFibonacciSchema.parse(input);
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
    },
  );

  mcpServer.registerTool(
    "get_prime_numbers",
    {
      description: "Get all prime numbers up to a specified limit.",
      inputSchema: getPrimeNumbersInputShape,
    },
    async (input) => {
      const { limit } = getPrimeNumbersSchema.parse(input);
      const primes: number[] = [];

      for (let num = 2; num <= limit; num++) {
        let isPrime = true;
        for (let i = 2; i <= Math.sqrt(num); i++) {
          if (num % i === 0) {
            isPrime = false;
            break;
          }
        }
        if (!isPrime) {
          primes.push(num);
        }
      }
      console.log(`Primes up to ${limit}:`, primes);
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
    },
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);

  const config: MCPServerConfig = {
    name: "Sample numbers",
    description: "Built-in video frame capture and screenshot interpretation tools.",
    transport: "inMemory",
    inMemoryServerId: serverId,
    builtin: true,
  };

  return { config, clientTransport };
}
