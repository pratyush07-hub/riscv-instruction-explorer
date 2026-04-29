# RISC-V Instruction Set Explorer

This is a JavaScript/Node.js based solution for the RISC-V Mentorship Coding Challenge.

## Features
- **Tier 1**: Parses the provided `instr_dict.json`, grouping instructions by extension and printing a summary table.
- **Tier 2**: Automatically clones the official RISC-V ISA manual, scans AsciiDoc sources for extensions, and cross-references them against the cataloged extensions.
- **Tier 3**: Generates a `.dot` graph mapping extensions that share instructions, and includes unit tests for core logic.

## Setup Instructions

### Prerequisites
- Node.js (v14 or higher recommended)
- `git` (for cloning the ISA manual)

### Installation
1. Clone or extract this repository.
2. Ensure you have the `instr_dict.json` file. By default, the script looks for `../src/instr_dict.json` relative to this folder, but you can change the `INSTR_DICT_PATH` in `explorer.js` if needed.
3. Install dependencies (for testing):
   ```bash
   npm install
   ```

### Running the Tool
To run the full explorer (Tier 1, Tier 2, and Tier 3):
```bash
node explorer.js
```
*Note: The first run may take a few seconds longer as it clones the official RISC-V ISA Manual repository.*

### Output Graph
The script will output a `shared_instructions.dot` file in this directory. 
You can view it using Graphviz tools:
```bash
dot -Tpng shared_instructions.dot -o graph.png
```
Or simply copy its contents to a web viewer like [GraphvizOnline](https://dreampuf.github.io/GraphvizOnline/).

### Running Tests
To run the included unit tests (validating parsing, matching, and normalization logic):
```bash
npm test
```

## Sample Output
When running `node explorer.js`, the program will output text similar to the following:
```text
--- Tier 1: Instruction Set Parsing ---
Summary Table:
rv64_a               |   22 instructions | e.g. AMOADD_D
rv_c                 |   34 instructions | e.g. C_ADD
...
Instructions belonging to more than one extension:
- aes32dsi: rv32_zknd, rv32_zk, rv32_zkn
...

--- Tier 2: Cross-Reference with the ISA Manual ---
Cloning RISC-V ISA manual...
Extensions present in instr_dict.json but not in manual:
zabha_zacas, zibi, c_d ...

Extensions mentioned in manual but not in instr_dict.json:
zb, some, sign ...

Count Summary:
58 matched, 27 in JSON only, 323 in manual only

--- Tier 3: Graph Generation ---
Generated text-based graph showing extensions that share instructions: .../shared_instructions.dot
```


## Design Decisions and Assumptions
- **Normalization Strategy**: Extension naming varies wildly. `rv32_zba` or `rv64_i` is used in `instr_dict.json`, while AsciiDoc might mention `Zba` or `M`. The `normalizeExtensionName` function lowercases everything and strips the `rv32_`, `rv64_`, and `rv_` prefixes to provide a common base name for accurate cross-referencing.
- **Regex Parsing**: Scanning AsciiDoc text uses a regular expression `\b([IMAFDQCVH]|Z[a-z0-9]+|S[a-z0-9]+|RV[32|64]?[A-Z]+)\b` to identify typical extension names. This captures standard single-letter extensions (I, M, A, etc.) and Z/S extensions. It handles things like `RV32I` by stripping the `RV32` and looking at the remaining `I`.
- **Graph Output**: We use a `graphviz` dot file format because it is lightweight, textual, and widely supported.
