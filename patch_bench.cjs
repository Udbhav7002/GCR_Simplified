const fs = require('fs');
let code = fs.readFileSync('src-tauri/benches/plagiarism_bench.rs', 'utf8');

code = code.replace(/gcr_app_lib::plagiarism::/g, 'gcr_app_lib::domain::plagiarism::');
code = code.replace(/fn generate_random_word\(\) -> String \{/g, 'fn generate_random_word() -> String {\n    let mut rng = thread_rng();');
fs.writeFileSync('src-tauri/benches/plagiarism_bench.rs', code);
