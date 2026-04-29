const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const REPO_URL = 'https://github.com/riscv/riscv-isa-manual.git';
const MANUAL_DIR = path.join(__dirname, 'riscv-isa-manual');
// Allow passing the JSON path as a CLI argument, fallback to default
const INSTR_DICT_PATH = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'src', 'instr_dict.json');

// Normalizes extension names for consistent comparison
// e.g. rv64_zba -> zba, rv_i -> i, Zba -> zba
function normalizeExtensionName(ext) {
  let lower = ext.toLowerCase();
  lower = lower.replace(/^rv(32|64)?_?/, '');
  return lower;
}

function runTier1() {
  console.log('--- Tier 1: Instruction Set Parsing ---');
  if (!fs.existsSync(INSTR_DICT_PATH)) {
    console.error(`Error: Could not find ${INSTR_DICT_PATH}. Please provide a valid path as a command-line argument.`);
    process.exit(1);
    return { extensionsMap: new Map(), multipleExtensionsInstructions: [], data: {} };
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(INSTR_DICT_PATH, 'utf8'));
  } catch (error) {
    console.error(`Error parsing JSON file at ${INSTR_DICT_PATH}:`, error.message);
    process.exit(1);
    return { extensionsMap: new Map(), multipleExtensionsInstructions: [], data: {} };
  }
  
  const extensionsMap = new Map();
  const multipleExtensionsInstructions = [];

  for (const [mnemonic, details] of Object.entries(data)) {
    if (details.extension && Array.isArray(details.extension)) {
      if (details.extension.length > 1) {
        multipleExtensionsInstructions.push({
          mnemonic,
          extensions: details.extension
        });
      }

      for (const ext of details.extension) {
        const normExt = normalizeExtensionName(ext);
        if (!extensionsMap.has(normExt)) {
          extensionsMap.set(normExt, {
            originalName: ext,
            count: 0,
            examples: []
          });
        }
        const extData = extensionsMap.get(normExt);
        extData.count++;
        if (extData.examples.length < 1) {
          extData.examples.push(mnemonic);
        }
      }
    }
  }

  console.log('Summary Table:');
  const sortedExtensions = Array.from(extensionsMap.keys()).sort();
  for (const ext of sortedExtensions) {
    const info = extensionsMap.get(ext);
    console.log(`${info.originalName.padEnd(20)} | ${info.count.toString().padStart(4)} instructions | e.g. ${info.examples[0].toUpperCase()}`);
  }

  console.log('\nInstructions belonging to more than one extension (Showing first 10 for brevity):');
  for (const item of multipleExtensionsInstructions.slice(0, 10)) {
    console.log(`- ${item.mnemonic}: ${item.extensions.join(', ')}`);
  }
  if (multipleExtensionsInstructions.length > 10) {
    console.log(`... and ${multipleExtensionsInstructions.length - 10} more.`);
  }
  console.log('');

  return { extensionsMap, multipleExtensionsInstructions, data };
}

function getAdocFiles(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      getAdocFiles(filePath, fileList);
    } else if (filePath.endsWith('.adoc')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

function runTier2(jsonExtensionsMap) {
  console.log('--- Tier 2: Cross-Reference with the ISA Manual ---');
  
  if (!fs.existsSync(MANUAL_DIR)) {
    console.log(`Cloning RISC-V ISA manual to ${MANUAL_DIR}...`);
    try {
      execSync(`git clone ${REPO_URL} ${MANUAL_DIR}`, { stdio: 'inherit' });
    } catch (error) {
      console.error(`Error cloning repository: ${error.message}`);
      process.exit(1);
    }
  } else {
    console.log('ISA manual repository already exists locally. Skipping clone.');
  }

  const srcDir = path.join(MANUAL_DIR, 'src');
  const adocFiles = getAdocFiles(srcDir);
  
  // --- Extension Detection Strategy ---
  // We use TWO separate regex strategies to minimize false positives:
  //
  // 1. Multi-letter extensions (Z*/S* prefixed, e.g. Zba, Svnapot) are unambiguous
  //    in text, so we match them broadly with a simple word-boundary regex.
  //
  // 2. Single-letter extensions (I, M, A, F, D, Q, C, V, H) are extremely common
  //    English letters. Matching them naively produces hundreds of false positives.
  //    Instead, we require them to appear in ISA-specific context, such as:
  //      - "the M extension", "M extension", "M-extension"
  //      - Inside an RV string like "RV32IMAFD"
  //      - Adjacent to another extension reference like "I/M/A"

  // Regex 1: Multi-letter extensions — safe to match broadly
  // Z-extensions: Any word starting with Z followed by lowercase (e.g. Zba, Zicsr, Zvbb)
  // S-extensions: Only match known RISC-V supervisor prefixes (Sv, Sm, Ss, Sh, Sn, Sd, Sp, St)
  //   to avoid catching English words like "Some", "Support", or author names like "Sewell"
  const multiLetterRegex = /\b(Z[a-z][a-z0-9]*|S[vmshndpt][a-z0-9]+)\b/g;

  // Regex 2: Single-letter extensions — only when in ISA context
  // Matches patterns like "the M extension", "M-extension", "M Extension"
  const singleLetterContextRegex = /\b([IMAFDQCVH])[\s-](?:extension|Extension)/g;

  // Regex 3: Full ISA strings like RV32I, RV64IMAFD, RV32GC
  const rvStringRegex = /\bRV(?:32|64)?([IMAFDQCVHG]+)\b/g;

  // A blocklist to filter out common words and author names that get caught by the S/Z-prefix regex.
  // The ISA manual AsciiDoc contains many author surnames (Sewell, Shanbhogue, Zhang, etc.)
  // and standard English words that start with S or Z, none of which are RISC-V extensions.
  const falsePositives = new Set([
    // Common English words starting with S or Z
    'some', 'sign', 'such', 'single', 'see', 'synopsis', 'should', 'set',
    'software', 'shift', 'zero', 'size', 'subsequent', 'state', 'standard',
    'section', 'since', 'store', 'stores', 'special', 'source', 'stack',
    'step', 'same', 'so', 'sp', 'support', 'spike', 'specific', 'similarly',
    'sensitivity', 'supervisor', 'su', 'ss', 'sv', 'sh', 'sm', 'specify',
    'shall', 'shown', 'system', 'systems', 'space', 'second', 'string',
    'subject', 'still', 'status', 'struct', 'structure', 'save', 'saved',
    'sub', 'summary', 'subset', 'synchronous', 'specification', 'shadow',
    'seed', 'setup', 'specifications', 'stage', 'setting', 'sret',
    'supplied', 'sbi', 'sharing', 'separate', 'separated', 'separates',
    'slot', 'slots', 'sample', 'sb', 'split', 'sn', 'selected', 'sr',
    'stable', 'starts', 'starting', 'stop', 'stopped', 'stopping',
    'supported', 'signed', 'short', 'shorter', 'simple', 'simplify',
    'switched', 'switching', 'swap', 'sd', 'se', 'sf', 'sg', 'si', 'sj',
    'sk', 'sl', 'sq', 'st', 'sw', 'sx', 'sy', 'sz',
    'zb', 'zc', 'zd', 'ze', 'zf', 'zg', 'zh', 'zi', 'zj', 'zk', 'zl',
    'zm', 'zn', 'zo', 'zp', 'zq', 'zr', 'zs', 'zt', 'zu', 'zv', 'zw',
    'zx', 'zy', 'zz',
    // Author surnames from the ISA manual contributors
    'scott', 'shaked', 'stefan', 'saarinen', 'susmit', 'sarkar', 'scheid',
    'schmidt', 'sewell', 'shanbhogue', 'spinney', 'sweeney', 'steve',
    'sizhuo', 'zhang', 'zabrocki', 'zandijk'
  ]);

  const manualExtensions = new Set();
  
  for (const file of adocFiles) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch (error) {
      console.warn(`Warning: Could not read file ${file}`);
      continue;
    }

    let match;

    // Pass 1: Multi-letter Z/S extensions (e.g. Zba, Svnapot, Zicsr)
    while ((match = multiLetterRegex.exec(content)) !== null) {
      const norm = normalizeExtensionName(match[1]);
      if (!falsePositives.has(norm)) manualExtensions.add(norm);
    }

    // Pass 2: Single-letter extensions only when followed by "extension" (e.g. "M extension")
    while ((match = singleLetterContextRegex.exec(content)) !== null) {
      manualExtensions.add(normalizeExtensionName(match[1]));
    }

    // Pass 3: Full RV strings (e.g. RV32IMAFD -> I, M, A, F, D)
    while ((match = rvStringRegex.exec(content)) !== null) {
      for (const char of match[1]) {
        manualExtensions.add(normalizeExtensionName(char));
      }
    }
  }

  const jsonExts = Array.from(jsonExtensionsMap.keys());
  const jsonSet = new Set(jsonExts);

  const matched = [];
  const jsonOnly = [];
  const manualOnly = [];

  for (const ext of jsonExts) {
    if (manualExtensions.has(ext)) {
      matched.push(ext);
    } else {
      jsonOnly.push(ext);
    }
  }

  for (const ext of manualExtensions) {
    if (!jsonSet.has(ext)) {
      manualOnly.push(ext);
    }
  }

  console.log(`Extensions present in instr_dict.json but not in manual:`);
  console.log(jsonOnly.length > 0 ? jsonOnly.join(', ') : 'None');
  
  console.log(`\nExtensions mentioned in manual but not in instr_dict.json (showing up to 20):`);
  console.log(manualOnly.length > 0 ? manualOnly.slice(0, 20).join(', ') + (manualOnly.length > 20 ? '...' : '') : 'None');

  console.log(`\nCount Summary:`);
  console.log(`${matched.length} matched, ${jsonOnly.length} in JSON only, ${manualOnly.length} in manual only\n`);
}

function runTier3(data) {
  console.log('--- Tier 3: Graph Generation ---');
  
  // Build a map of extensions -> set of shared extensions
  const adjacencyList = new Map();

  for (const [mnemonic, details] of Object.entries(data)) {
    if (details.extension && Array.isArray(details.extension) && details.extension.length > 1) {
      const exts = details.extension.map(normalizeExtensionName);
      
      for (let i = 0; i < exts.length; i++) {
        for (let j = i + 1; j < exts.length; j++) {
          const u = exts[i];
          const v = exts[j];
          
          if (!adjacencyList.has(u)) adjacencyList.set(u, new Set());
          if (!adjacencyList.has(v)) adjacencyList.set(v, new Set());
          
          adjacencyList.get(u).add(v);
          adjacencyList.get(v).add(u);
        }
      }
    }
  }

  // Generate DOT file
  let dotFile = 'graph {\n';
  dotFile += '  node [shape=box, style=filled, color=lightblue];\n';
  
  const edges = new Set();
  
  for (const [u, neighbors] of adjacencyList.entries()) {
    for (const v of neighbors) {
      // Create canonical edge name to avoid A--B and B--A
      const edge = [u, v].sort().join(' -- ');
      if (!edges.has(edge)) {
        edges.add(edge);
        dotFile += `  "${u}" -- "${v}";\n`;
      }
    }
  }
  
  dotFile += '}\n';
  
  const dotPath = path.join(__dirname, 'shared_instructions.dot');
  fs.writeFileSync(dotPath, dotFile);
  console.log(`Generated text-based graph showing extensions that share instructions: ${dotPath}`);
  console.log('You can visualize this file online at https://dreampuf.github.io/GraphvizOnline/ or using the \'dot\' command line tool.\n');
}

function main() {
  const { extensionsMap, data } = runTier1();
  runTier2(extensionsMap);
  runTier3(data);
}

if (require.main === module) {
  main();
}

module.exports = {
  normalizeExtensionName,
  runTier1
};
