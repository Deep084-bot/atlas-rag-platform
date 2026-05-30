import app from './app.js';

const port = Number(process.env.PORT ?? 8787);

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Atlas API listening on http://localhost:${port}`);
});
