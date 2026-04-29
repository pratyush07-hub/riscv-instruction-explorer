const fs = require('fs');
const { normalizeExtensionName } = require('./explorer');

describe('RISC-V Extension Name Normalization', () => {
  it('should handle standard extensions', () => {
    expect(normalizeExtensionName('rv_i')).toBe('i');
    expect(normalizeExtensionName('rv32_zba')).toBe('zba');
    expect(normalizeExtensionName('rv64_zba')).toBe('zba');
  });

  it('should handle casing differences', () => {
    expect(normalizeExtensionName('Zba')).toBe('zba');
    expect(normalizeExtensionName('M')).toBe('m');
    expect(normalizeExtensionName('RV64G')).toBe('g'); // the naive approach drops RV64
  });

  it('should handle extensions without rv_ prefix', () => {
    expect(normalizeExtensionName('zicsr')).toBe('zicsr');
    expect(normalizeExtensionName('Zifencei')).toBe('zifencei');
  });
});

describe('Tier 1 Logic (Mocked)', () => {
  const originalJsonParse = JSON.parse;
  const originalReadFileSync = fs.readFileSync;
  const originalExistsSync = fs.existsSync;

  beforeEach(() => {
    fs.existsSync = jest.fn(() => true);
    fs.readFileSync = jest.fn(() => JSON.stringify({
      "add": { "extension": ["rv_i"] },
      "add_uw": { "extension": ["rv64_zba"] },
      "aes32dsi": { "extension": ["rv32_zknd", "rv32_zk", "rv32_zkn"] }
    }));
  });

  afterEach(() => {
    fs.existsSync = originalExistsSync;
    fs.readFileSync = originalReadFileSync;
    JSON.parse = originalJsonParse;
  });

  it('should correctly parse instructions and group by normalized extensions', () => {
    const { runTier1 } = require('./explorer');
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    
    const { extensionsMap, multipleExtensionsInstructions } = runTier1();

    expect(extensionsMap.has('i')).toBe(true);
    expect(extensionsMap.get('i').count).toBe(1);
    expect(extensionsMap.get('i').examples).toContain('add');

    expect(extensionsMap.has('zba')).toBe(true);
    expect(extensionsMap.get('zba').count).toBe(1);

    expect(extensionsMap.has('zk')).toBe(true);
    expect(extensionsMap.get('zk').count).toBe(1);
    
    expect(multipleExtensionsInstructions.length).toBe(1);
    expect(multipleExtensionsInstructions[0].mnemonic).toBe('aes32dsi');
    
    consoleSpy.mockRestore();
  });
});

describe('Error Handling - Malformed JSON', () => {
  const originalReadFileSync = fs.readFileSync;
  const originalExistsSync = fs.existsSync;
  const originalExit = process.exit;

  beforeEach(() => {
    // Mock process.exit to prevent Jest from actually exiting
    process.exit = jest.fn();
  });

  afterEach(() => {
    fs.existsSync = originalExistsSync;
    fs.readFileSync = originalReadFileSync;
    process.exit = originalExit;
  });

  it('should gracefully handle malformed JSON input', () => {
    fs.existsSync = jest.fn(() => true);
    // Return invalid JSON (missing closing brace)
    fs.readFileSync = jest.fn(() => '{ "add": { "extension": ["rv_i"] }');

    const { runTier1 } = require('./explorer');
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    runTier1();

    // Verify the program called process.exit(1) instead of crashing
    expect(process.exit).toHaveBeenCalledWith(1);
    // Verify it printed a helpful error message
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error parsing JSON'),
      expect.any(String)
    );

    consoleSpy.mockRestore();
  });

  it('should gracefully handle a missing JSON file', () => {
    fs.existsSync = jest.fn(() => false);

    const { runTier1 } = require('./explorer');
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    runTier1();

    // Verify the program called process.exit(1) instead of crashing
    expect(process.exit).toHaveBeenCalledWith(1);
    // Verify it printed a helpful error message about the missing file
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Could not find')
    );

    consoleSpy.mockRestore();
  });
});
