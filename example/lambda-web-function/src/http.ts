import { createServer } from "node:http";

const server = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.url === "/" && req.method === "GET") {
    res.statusCode = 200;
    res.end(JSON.stringify({ message: "Welcome!" }));
  } else if (req.url === "/users" && req.method === "GET") {
    res.statusCode = 200;
    res.end(JSON.stringify({ users: ["Alice", "Bob"] }));
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Not found" }));
  }
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
});
