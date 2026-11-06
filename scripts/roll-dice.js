#!/usr/bin/env node

/**
 * Cross-Platform D&D Dice Roller CLI Tool
 * Works natively on Windows, macOS, and Linux via Node.js.
 *
 * Usage:
 *   node scripts/roll-dice.js <expression> [options]
 *
 * Examples:
 *   node scripts/roll-dice.js 1d20+5 --label "Attack roll"
 *   node scripts/roll-dice.js 1d20+3 --adv --label "Perception with Advantage"
 *   node scripts/roll-dice.js 1d20+1 --dis --label "Stealth in heavy armor"
 *   node scripts/roll-dice.js 2d6+3 --crit --label "Greatsword Critical Hit!"
 *   node scripts/roll-dice.js 1d20+6 --hidden --label "Goblin Stealth"
 *   node scripts/roll-dice.js 1d20+4 --dc 15 --label "Lockpicking DC 15"
 *   node scripts/roll-dice.js 4d6kh3 --label "Stat Roll (Drop Lowest)"
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
};

function rollDie(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

function printHelp() {
  console.log(`
${colors.bright}${colors.cyan}🎲 D&D Cross-Platform Dice Roller${colors.reset}

${colors.yellow}Usage:${colors.reset}
  node scripts/roll-dice.js <dice-expression> [options]

${colors.yellow}Expressions:${colors.reset}
  1d20+5          Standard d20 roll with modifier
  2d6+3           Multi-dice damage roll
  4d6kh3          Roll 4d6, keep highest 3 (stat generation)
  1d100           Percentile die

${colors.yellow}Options:${colors.reset}
  --label "<text>"      Description for the roll (e.g., "Perception check")
  --adv, --advantage    Roll twice on d20, take the higher result
  --dis, --disadvantage Roll twice on d20, take the lower result
  --crit                Double the dice count for critical hit damage
  --dc <number>         Evaluate against target DC (Success / Failure)
  --hidden              Output ONLY the final total number (for secret DM rolls)
  --batch <count>       Roll the expression multiple times
  --help, -h            Show this help message
`);
}

function parseArgs(args) {
  const parsed = {
    expr: null,
    label: '',
    advantage: false,
    disadvantage: false,
    crit: false,
    dc: null,
    hidden: false,
    batch: 1,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--label') {
      parsed.label = args[++i] || '';
    } else if (arg === '--adv' || arg === '--advantage') {
      parsed.advantage = true;
    } else if (arg === '--dis' || arg === '--disadvantage') {
      parsed.disadvantage = true;
    } else if (arg === '--crit') {
      parsed.crit = true;
    } else if (arg === '--hidden') {
      parsed.hidden = true;
    } else if (arg === '--dc') {
      parsed.dc = parseInt(args[++i], 10);
    } else if (arg === '--batch') {
      parsed.batch = parseInt(args[++i], 10) || 1;
    } else if (!parsed.expr && !arg.startsWith('-')) {
      parsed.expr = arg;
    }
  }

  return parsed;
}

function parseDiceExpression(expr) {
  const clean = expr.replace(/\s+/g, '');
  if (!clean) {
    throw new Error(`Invalid dice expression: "${expr}". Examples: 1d20+5, 2d6+1d8+3, 4d6kh3`);
  }

  // Check 4d6kh3 special syntax first (keep highest N)
  const khMatch = clean.match(/^(\d+)?d(\d+)kh(\d+)([+-]\d+)?$/i);
  if (khMatch) {
    const numDice = parseInt(khMatch[1] || '1', 10);
    const sides = parseInt(khMatch[2], 10);
    const keepCount = parseInt(khMatch[3], 10);
    if (numDice <= 0 || sides <= 0 || numDice > 100 || sides > 1000 || keepCount <= 0 || keepCount > numDice) {
      throw new Error(`Dice count, sides, or keep count out of range in "${expr}"`);
    }
    return {
      type: 'kh',
      numDice,
      sides,
      keepCount,
      mod: parseInt(khMatch[4] || '0', 10)
    };
  }

  // Tokenize signed terms: e.g. "+1d8", "-2d6", "+5", "-3", "1d20"
  const regex = /([+-]?)(?:(\d*)d(\d+)|(\d+))/gi;
  const terms = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(clean)) !== null) {
    if (match.index !== lastIndex) {
      throw new Error(`Invalid dice expression: "${expr}". Examples: 1d20+5, 2d6+1d8+3, 4d6kh3`);
    }
    lastIndex = regex.lastIndex;

    const sign = match[1] === '-' ? -1 : 1;
    if (match[3] !== undefined) {
      const count = parseInt(match[2] || '1', 10);
      const sides = parseInt(match[3], 10);
      if (count <= 0 || sides <= 0 || count > 100 || sides > 1000) {
        throw new Error(`Dice count or sides out of range in "${expr}"`);
      }
      terms.push({ type: 'dice', sign, count, sides, raw: match[0] });
    } else if (match[4] !== undefined) {
      const val = parseInt(match[4], 10);
      terms.push({ type: 'mod', sign, val: sign * val, raw: match[0] });
    }
  }

  if (lastIndex !== clean.length || terms.length === 0) {
    throw new Error(`Invalid dice expression: "${expr}". Examples: 1d20+5, 2d6+1d8+3, 4d6kh3`);
  }

  return { type: 'compound', terms };
}

function executeSingleRoll(expr, options) {
  const parsed = parseDiceExpression(expr);

  // 1. Keep-highest syntax (4d6kh3)
  if (parsed.type === 'kh') {
    const { numDice, sides, keepCount, mod } = parsed;
    const rolls = [];
    for (let i = 0; i < numDice; i++) rolls.push(rollDie(sides));
    const sorted = [...rolls].sort((a, b) => b - a);
    const kept = sorted.slice(0, keepCount);
    const total = kept.reduce((a, b) => a + b, 0) + mod;

    return {
      expr,
      rolls,
      kept,
      mod,
      total,
      d20Special: null
    };
  }

  const terms = parsed.terms;
  const diceTerms = terms.filter(t => t.type === 'dice');
  const hasD20Check = diceTerms.some(t => t.sides === 20);

  // 2. Simple single-dice expression (backward-compatible fast-path for positive single dice)
  if (diceTerms.length === 1 && diceTerms[0].sign === 1 && (terms.length === 1 || (terms.length === 2 && terms[1].type === 'mod'))) {
    const diceTerm = diceTerms[0];
    let numDice = diceTerm.count;
    const sides = diceTerm.sides;
    const mod = terms.length === 2 ? terms[1].val : 0;

    if (options.crit && sides !== 20) {
      numDice *= 2;
    }

    // Handle advantage / disadvantage on d20
    if (sides === 20 && (options.advantage || options.disadvantage)) {
      const r1 = rollDie(20);
      const r2 = rollDie(20);
      let chosen;
      if (options.advantage && options.disadvantage) {
        chosen = r1; // cancel out
      } else if (options.advantage) {
        chosen = Math.max(r1, r2);
      } else {
        chosen = Math.min(r1, r2);
      }
      const total = chosen + mod;

      let d20Special = null;
      if (chosen === 20) d20Special = 'NATURAL 20!';
      else if (chosen === 1) d20Special = 'NATURAL 1!';

      return {
        expr: `${expr} (${options.advantage ? 'Advantage' : 'Disadvantage'})`,
        rolls: [r1, r2],
        chosen,
        mod,
        total,
        d20Special
      };
    }

    // Standard single roll
    const rolls = [];
    let sum = 0;
    for (let i = 0; i < numDice; i++) {
      const r = rollDie(sides);
      rolls.push(r);
      sum += r;
    }
    const total = sum + mod;

    let d20Special = null;
    if (sides === 20 && numDice === 1) {
      if (rolls[0] === 20) d20Special = 'NATURAL 20!';
      else if (rolls[0] === 1) d20Special = 'NATURAL 1!';
    }

    return {
      expr,
      rolls,
      mod,
      total,
      d20Special
    };
  }

  // 3. Compound multi-dice expression (e.g., 1d8+3+2d8, 1d20+5+1d4)
  const allRolls = [];
  const termResults = [];
  let totalMod = 0;
  let totalSum = 0;
  let d20Special = null;

  for (const term of terms) {
    if (term.type === 'mod') {
      totalMod += term.val;
      termResults.push({ type: 'mod', value: term.val });
    } else if (term.type === 'dice') {
      let numDice = term.count;
      // Only double damage dice on critical hits (not bonus dice like 1d4 Bless on a d20 check)
      if (options.crit && term.sides !== 20 && !hasD20Check) {
        numDice *= 2;
      }

      if (term.sides === 20 && numDice === 1 && (options.advantage || options.disadvantage)) {
        const r1 = rollDie(20);
        const r2 = rollDie(20);
        let chosen;
        if (options.advantage && options.disadvantage) chosen = r1;
        else if (options.advantage) chosen = Math.max(r1, r2);
        else chosen = Math.min(r1, r2);
        allRolls.push(chosen);
        totalSum += chosen * term.sign;
        if (chosen === 20) d20Special = 'NATURAL 20!';
        else if (chosen === 1 && !d20Special) d20Special = 'NATURAL 1!';
        termResults.push({
          type: 'dice',
          expr: `${term.count}d${term.sides}`,
          rolls: [r1, r2],
          chosen,
          sign: term.sign,
          total: chosen * term.sign
        });
      } else {
        const rolls = [];
        let sum = 0;
        for (let i = 0; i < numDice; i++) {
          const r = rollDie(term.sides);
          rolls.push(r);
          allRolls.push(r);
          sum += r;
        }
        if (term.sides === 20 && numDice === 1) {
          if (rolls[0] === 20) d20Special = 'NATURAL 20!';
          else if (rolls[0] === 1 && !d20Special) d20Special = 'NATURAL 1!';
        }
        totalSum += sum * term.sign;
        termResults.push({
          type: 'dice',
          expr: `${numDice}d${term.sides}`,
          rolls,
          sign: term.sign,
          total: sum * term.sign
        });
      }
    }
  }

  const total = totalSum + totalMod;
  return {
    expr,
    rolls: allRolls,
    terms: termResults,
    mod: totalMod,
    total,
    d20Special
  };
}

function main() {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);

  if (parsed.help || !parsed.expr) {
    printHelp();
    process.exit(parsed.help ? 0 : 1);
  }

  try {
    for (let b = 0; b < parsed.batch; b++) {
      const result = executeSingleRoll(parsed.expr, parsed);

      if (parsed.hidden) {
        // In hidden mode, output minimal raw result for secret DM tracking
        let out = `${result.total}`;
        if (parsed.dc !== null) {
          out += result.total >= parsed.dc ? ` (SUCCESS vs DC ${parsed.dc})` : ` (FAILURE vs DC ${parsed.dc})`;
        }
        if (result.d20Special) out += ` [${result.d20Special}]`;
        console.log(out);
        continue;
      }

      // Pretty formatted output
      console.log(`\n${colors.bright}${colors.cyan}🎲 D&D Dice Roll${colors.reset}`);
      if (parsed.label) {
        console.log(`${colors.yellow}Label:${colors.reset}   ${parsed.label}`);
      }
      console.log(`${colors.dim}Formula:${colors.reset} ${result.expr}`);

      if (result.terms && result.terms.length > 1) {
        const breakdownStr = result.terms.map(t => {
          if (t.type === 'mod') {
            return t.value >= 0 ? `+ ${t.value}` : `- ${Math.abs(t.value)}`;
          }
          const signStr = t.sign < 0 ? '- ' : '';
          const diceVals = t.chosen !== undefined ? `[${t.rolls.join(', ')} -> Kept ${t.chosen}]` : `[${t.rolls.join(', ')}]`;
          return `${signStr}${t.expr} ${diceVals}`;
        }).join(' ');
        console.log(`${colors.dim}Terms:${colors.reset}   ${breakdownStr}`);
      } else if (result.chosen !== undefined) {
        console.log(`${colors.dim}Dice:${colors.reset}    [${result.rolls.join(', ')}] -> Kept ${colors.bright}${result.chosen}${colors.reset}`);
      } else if (result.kept) {
        console.log(`${colors.dim}Dice:${colors.reset}    [${result.rolls.join(', ')}] -> Kept [${result.kept.join(', ')}]`);
      } else {
        console.log(`${colors.dim}Dice:${colors.reset}    [${result.rolls.join(', ')}] (Sum: ${result.rolls.reduce((a, b) => a + b, 0)})`);
      }

      const modStr = result.mod > 0 ? ` + ${result.mod}` : result.mod < 0 ? ` - ${Math.abs(result.mod)}` : '';
      const baseVal = result.total - result.mod;
      console.log(`${colors.bright}Result:${colors.reset}  ${colors.green}${colors.bright}${result.total}${colors.reset}${colors.dim}${result.mod !== 0 ? ` (${baseVal}${modStr})` : ''}${colors.reset}`);

      if (result.d20Special) {
        const specialColor = result.d20Special.includes('20') ? colors.magenta : colors.red;
        console.log(`${specialColor}${colors.bright}★ ${result.d20Special} ★${colors.reset}`);
      }

      if (parsed.dc !== null) {
        const success = result.total >= parsed.dc;
        if (success) {
          console.log(`${colors.green}${colors.bright}✓ SUCCESS${colors.reset} ${colors.dim}(DC ${parsed.dc})${colors.reset}`);
        } else {
          console.log(`${colors.red}${colors.bright}✗ FAILURE${colors.reset} ${colors.dim}(DC ${parsed.dc})${colors.reset}`);
        }
      }
    }
  } catch (err) {
    console.error(`${colors.red}Error: ${err.message}${colors.reset}`);
    process.exit(1);
  }
}

/**
 * Programmatic roll function for in-process execution (<0.1ms)
 */
export function roll(expr, options = {}) {
  const parsedOpts = {
    expr,
    advantage: Boolean(options.advantage || options.adv),
    disadvantage: Boolean(options.disadvantage || options.dis),
    crit: Boolean(options.crit),
    dc: options.dc !== undefined && options.dc !== null ? parseInt(options.dc, 10) : null,
    hidden: Boolean(options.hidden),
    label: options.label || '',
    batch: options.batch || 1
  };
  const result = executeSingleRoll(expr, parsedOpts);
  if (parsedOpts.dc !== null) {
    result.success = result.total >= parsedOpts.dc;
  }
  return result;
}

export { executeSingleRoll, parseArgs };
export default roll;

const isMain = process.argv[1] && (
  path.resolve(process.argv[1]) === __filename ||
  path.resolve(process.argv[1]) === path.resolve(__dirname, 'roll-dice.js')
);

if (isMain) {
  main();
}

