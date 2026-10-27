'use strict';

// 一次跑完所有单测。用普通 node 启动（而不是 node --test 的进程隔离），
// 在受限环境里也能跑；CI 里 `npm test` 等价于 `node --test tests/`。
require('./persona.test');
require('./personaStore.test');
require('./care.test');
require('./gateway.test');
require('./demo.test');
require('./life.test');
