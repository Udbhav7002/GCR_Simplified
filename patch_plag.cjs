const fs = require('fs');
let code = fs.readFileSync('src/pages/PlagiarismReport.tsx', 'utf8');
code = code.replace(
    /import \{ useToast, friendlyError \} from "@\/components\/ui\/toaster";/,
    `import { useToast, friendlyError } from "@/components/ui/toaster";\nimport { buildClusters, clusterStudents } from "@/lib/clusters";`
);
fs.writeFileSync('src/pages/PlagiarismReport.tsx', code);
