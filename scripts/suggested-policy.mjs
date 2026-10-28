// The policy the real-agent examples use: read allowed, write asks a person, delete never. One definition for setup and the offline try-out.
export const SUGGESTED_POLICY = [
  { tool: "read_test_file", action: "read", effect: "allow" },
  { tool: "write_test_file", action: "create", effect: "approve" },
  { tool: "delete_test_file", action: "delete", effect: "deny" },
];
