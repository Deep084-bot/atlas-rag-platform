import "dotenv/config";
import app from "./app.js";

console.log(
  "DATABASE_URL:",
  process.env.DATABASE_URL ? "FOUND" : "MISSING"
);

const port = Number(process.env.PORT ?? 8787);

app.listen(port, () => {
  console.log(`Atlas API listening on http://localhost:${port}`);
});