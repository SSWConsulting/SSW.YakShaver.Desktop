import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import { Button } from "../ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../ui/form";
import { Textarea } from "../ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Input } from "../ui/input";

const mcpServerSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .regex(
      /^[a-zA-Z0-9 _-]+$/,
      "Only letters, numbers, spaces, underscores, and hyphens allowed"
    ),
  description: z.string().optional(),
  transport: z.enum(["streamableHttp", "stdio"]),
  url: z.string().url("Must be a valid URL"),
  headers: z.string().optional(),
  version: z.string().optional(),
  timeoutMs: z.number().positive().optional().or(z.literal("")),
});

type MCPServerFormData = z.infer<typeof mcpServerSchema>;

export type MCPServerConfig = {
  name: string;
  description?: string;
  transport: "streamableHttp" | "stdio";
  url: string;
  headers?: Record<string, string>;
  version?: string;
  timeoutMs?: number;
};

type McpServerFormProps = {
  initialData?: MCPServerConfig;
  isEditing?: boolean;
  onSubmit: (data: MCPServerConfig) => Promise<void>;
  onCancel: () => void;
  loading?: boolean;
};

export function McpServerForm({
  initialData,
  isEditing = false,
  onSubmit,
  onCancel,
  loading = false,
}: McpServerFormProps) {
  const form = useForm<MCPServerFormData>({
    resolver: zodResolver(mcpServerSchema),
    defaultValues: {
      name: initialData?.name || "",
      description: initialData?.description || "",
      transport: initialData?.transport || "streamableHttp",
      url: initialData?.url || "",
      headers: initialData?.headers
        ? JSON.stringify(initialData.headers, null, 2)
        : "{}",
      version: initialData?.version || "",
      timeoutMs: initialData?.timeoutMs || undefined,
    },
  });

  async function handleSubmit(data: MCPServerFormData) {
    let headers: Record<string, string> | undefined;

    if (data.headers?.trim()) {
      try {
        headers = JSON.parse(data.headers);
      } catch {
        form.setError("headers", { message: "Invalid JSON format" });
        return;
      }
    }

    const config: MCPServerConfig = {
      name: data.name.trim(),
      url: data.url.trim(),
      transport: data.transport,
      description: data.description?.trim() || undefined,
      headers,
      version: data.version?.trim() || undefined,
      timeoutMs:
        typeof data.timeoutMs === "number" ? data.timeoutMs : undefined,
    };

    await onSubmit(config);
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="flex flex-col gap-4"
      >
        <h3 className="text-white text-xl font-semibold">
          {isEditing ? "Edit Server" : "Add New Server"}
        </h3>

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-white/90">
                Name <span className="text-red-400">*</span>
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="text"
                  placeholder="e.g., GitHub"
                  disabled={isEditing}
                  className="w-full bg-black/40 border border-white/20 rounded-md px-3 py-2 text-white focus:border-white/40 focus:outline-none"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-white/90">Description</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="text"
                  placeholder="e.g., GitHub MCP Server"
                  className="w-full bg-black/40 border border-white/20 rounded-md px-3 py-2 text-white focus:border-white/40 focus:outline-none"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="url"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-white/90">
                URL <span className="text-red-400">*</span>
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="text"
                  placeholder="e.g., https://api.example.com/mcp/"
                  className="w-full bg-black/40 border border-white/20 rounded-md px-3 py-2 text-white font-mono text-sm focus:border-white/40 focus:outline-none"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="transport"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-white/90">Transport</FormLabel>
              <FormControl>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={field.disabled}
                >
                  <SelectTrigger className="w-full bg-black/40 border border-white/20 rounded-md px-3 py-2 text-white focus:border-white/40 focus:outline-none">
                    <SelectValue placeholder="Transport" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="streamableHttp">
                      HTTP (streamableHttp)
                    </SelectItem>
                    <SelectItem value="stdio">Stdio (local process)</SelectItem>
                  </SelectContent>
                </Select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Accordion type="single" collapsible>
          <AccordionItem value="advanced">
            <AccordionTrigger className="text-base font-medium text-white/90">
              Advanced Options
            </AccordionTrigger>
            <AccordionContent className="flex flex-col gap-4 pt-4">
              <FormField
                control={form.control}
                name="headers"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/90">Headers</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder='{"Authorization": "Bearer YOUR_TOKEN"}'
                        rows={4}
                        className="text-white font-mono text-xs bg-black/40 border-white/20"
                      />
                    </FormControl>
                    <FormDescription className="text-white/60 text-xs">
                      JSON format, e.g., Authorization headers
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="version"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/90">Version</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="text"
                        placeholder="e.g., 1.0.0"
                        className="w-full bg-black/40 border border-white/20 rounded-md px-3 py-2 text-white focus:border-white/40 focus:outline-none"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="timeoutMs"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/90">
                      Timeout (ms)
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value ? Number(e.target.value) : ""
                          )
                        }
                        type="number"
                        placeholder="60000"
                        className="w-full bg-black/40 border border-white/20 rounded-md px-3 py-2 text-white focus:border-white/40 focus:outline-none"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="flex gap-3 justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={loading}
            className="bg-neutral-800 text-white border-neutral-700 hover:bg-neutral-800/80 hover:text-white/80"
          >
            Cancel
          </Button>
          <Button variant="secondary" type="submit" disabled={loading}>
            {loading ? "Saving..." : "Save Server"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
