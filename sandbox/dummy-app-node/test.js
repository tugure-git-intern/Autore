"use strict";

const assert = require("node:assert");
const test = require("node:test");
const { GREETING, makeServer } = require("./app.js");

test("endpoint / dan /health menjawab seperti dummy app Python", async (t) => {
  const server = makeServer(0);
  t.after(() => server.close());
  const dasar = `http://127.0.0.1:${server.address().port}`;

  const sehat = await fetch(`${dasar}/health`);
  assert.equal(sehat.status, 200);
  assert.deepEqual(await sehat.json(), { status: "ok" });

  const akar = await fetch(dasar);
  assert.equal(akar.status, 200);
  assert.equal(await akar.text(), GREETING);

  const hilang = await fetch(`${dasar}/tidak-ada`);
  assert.equal(hilang.status, 404);
});
