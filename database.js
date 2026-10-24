'use strict';
const fs = require('node:fs');
const path = require('node:path');

// One asynchronous interface for local SQLite and hosted libSQL/Turso.
module.exports = async function openDatabase() {
  const url = process.env.TURSO_DATABASE_URL;
  if (url) {
    if (process.env.VERCEL && !/^libsql:\/\/|^https:\/\//.test(url)) throw new Error('Vercel requires a remote Turso URL.');
    const { createClient } = require('@libsql/client');
    const client = createClient({url,authToken:process.env.TURSO_AUTH_TOKEN});
    return {
      async exec(sql) {
        // These pragmas apply only to a local SQLite file, not a hosted connection.
        await client.executeMultiple(sql.replace(/PRAGMA (journal_mode|busy_timeout)\s*=[^;]+;/gi,''));
      },
      prepare(sql) {
        return {
          async get(...args) { return (await client.execute({sql,args})).rows[0]; },
          async all(...args) { return (await client.execute({sql,args})).rows.map(row=>({...row})); },
          async run(...args) { const result=await client.execute({sql,args});return {lastInsertRowid:result.lastInsertRowid,changes:result.rowsAffected}; },
        };
      },
      close() { client.close(); },
    };
  }
  if (process.env.VERCEL) throw new Error('Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN before deploying the backend. Local SQLite cannot persist on Vercel.');
  const { DatabaseSync } = require('node:sqlite');
  const filename=process.env.DB_PATH || path.join(__dirname,'data','appointments.db');
  fs.mkdirSync(path.dirname(path.resolve(filename)),{recursive:true});
  const database=new DatabaseSync(filename);
  return {
    async exec(sql) { database.exec(sql); },
    prepare(sql) {
      const statement=database.prepare(sql);
      return {
        async get(...args) { return statement.get(...args); },
        async all(...args) { return statement.all(...args); },
        async run(...args) { return statement.run(...args); },
      };
    },
    close() { database.close(); },
  };
};
