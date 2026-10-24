'use strict';
const {spawnSync}=require('node:child_process');
const result=spawnSync(process.execPath,['--test','test/backend.test.js'],{stdio:'inherit',env:{...process.env,TEST_LIBSQL:'1'}});
process.exit(result.status ?? 1);
