const fs = require('fs');
let code = fs.readFileSync('src-tauri/src/core/security.rs', 'utf8');

code = code.replace(/entry\.delete_password\(\)/g, 'entry.delete_credential()');
fs.writeFileSync('src-tauri/src/core/security.rs', code);
