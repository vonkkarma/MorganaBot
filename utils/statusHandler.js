const dataManager = require('./DataManager');

// Helper function to check if a demon has a specific status effect
async function hasStatusEffect(demon, statusName) {
  return demon.statusEffects &&
    demon.statusEffects.some(status =>
      status.name.toLowerCase() === statusName.toLowerCase() &&
      status.turnsRemaining > 0
    );
}

// Helper to get a status effect on a demon
async function getStatusEffect(demon, statusName) {
  if (!demon.statusEffects) return null;
  return demon.statusEffects.find(status =>
    status.name.toLowerCase() === statusName.toLowerCase() &&
    status.turnsRemaining > 0
  );
}

// Add a status effect to a demon
async function addStatusEffect(demon, statusName, source = null) {
  if (!demon.statusEffects) {
    demon.statusEffects = [];
  }

  // Check for immunities, etc.
  if (demon.resistances?.immune?.includes(statusName)) {
    return { success: false, reason: 'immune' };
  }

  // Get the status effect data
  const effect = await dataManager.getStatusEffect(statusName);
  if (!effect) {
    return { success: false, reason: 'invalid_status' };
  }

  // Check if demon already has this status effect
  const existingEffect = await getStatusEffect(demon, statusName);

  // Handle stacking logic
  if (existingEffect) {
    if (effect.stackable && existingEffect.stacks < (effect.maxStacks || 1)) {
      existingEffect.stacks += 1;
      existingEffect.turnsRemaining = effect.turnDuration;

      // Update multipliers based on stacks
      if (effect.battleEffect) {
        Object.keys(effect.battleEffect).forEach(stat => {
          const baseMultiplier = effect.battleEffect[stat];
          // Calculate multiplier difference from 1.0
          const diff = baseMultiplier - 1.0;
          // Apply stacked multiplier
          existingEffect.battleEffect[stat] = 1.0 + (diff * existingEffect.stacks);
        });
      }

      return { success: true, status: existingEffect, stacked: true };
    } else if (!effect.stackable) {
      // Just refresh the duration for non-stackable effects
      existingEffect.turnsRemaining = effect.turnDuration;
      return { success: true, status: existingEffect, refreshed: true };
    }
    return { success: false, reason: 'max_stacks' };
  }

  // For ailments, check if the demon is already afflicted with another ailment
  const statusEffects = await dataManager.getStatusEffects();
  if (effect.type === 'ailment' &&
    demon.statusEffects.some(s => statusEffects[s.name]?.type === 'ailment' && s.turnsRemaining > 0)) {
    return { success: false, reason: 'already_afflicted' };
  }

  // Create a new status effect instance
  const newStatus = {
    name: statusName,
    turnsRemaining: effect.turnDuration,
    stacks: 1,
    source: source,
    ...effect
  };

  demon.statusEffects.push(newStatus);
  return { success: true, status: newStatus, new: true };
}

// Remove a specific status effect
function removeStatusEffect(demon, statusName) {
  if (!demon.statusEffects) return false;

  const initialLength = demon.statusEffects.length;
  demon.statusEffects = demon.statusEffects.filter(status => status.name !== statusName);

  return demon.statusEffects.length < initialLength;
}

// Process status effects at the start of a turn
async function processStatusEffectsStart(demon, message) {
  if (!demon.statusEffects || demon.statusEffects.length === 0) return true;

  const statusEffects = await dataManager.getStatusEffects();

  // Check for ailments that prevent actions
  for (const status of demon.statusEffects) {
    const effect = statusEffects[status.name];

    if (effect && !effect.canAct) {
      const demonName = demon.userId ? `<@${demon.userId}> (${demon.name})` : demon.name;
      message.channel.send(`${demonName} is afflicted with ${effect.emoji} ${effect.name} and cannot act!`);
      return false;
    }

    // Check for skip turn chance on things like Shock
    if (effect && effect.skipTurnChance && Math.random() * 100 < effect.skipTurnChance) {
      const demonName = demon.userId ? `<@${demon.userId}> (${demon.name})` : demon.name;
      message.channel.send(`${demonName} is ${effect.emoji} ${effect.name}ed and loses their turn!`);
      return false;
    }
  }

  return true; // Can act
}

// Process status effects at the end of a turn
async function processStatusEffectsEnd(demon, message) {
  if (!demon.statusEffects || demon.statusEffects.length === 0) return;

  const demonName = demon.userId ? `<@${demon.userId}> (${demon.name})` : demon.name;
  let statusMessages = [];
  let expiredStatuses = [];
  const statusEffects = await dataManager.getStatusEffects();

  // Apply turn-end effects and reduce durations
  for (const status of demon.statusEffects) {
    const effect = statusEffects[status.name];

    // Process damage-over-time effects
    if (status.turnEffect && status.turnEffect.damagePercent) {
      const damage = Math.floor(demon.maxHp * status.turnEffect.damagePercent);
      demon.hp = Math.max(1, demon.hp - damage); // Don't kill with status damage
      statusMessages.push(`${demonName} takes ${damage} damage from ${effect.emoji} ${effect.name}!`);
    }

    // Decrease turn counter
    status.turnsRemaining--;

    // Check if the status has expired
    if (status.turnsRemaining <= 0) {
      expiredStatuses.push(status.name);
    }
  }

  // Remove expired status effects
  for (const expiredStatus of expiredStatuses) {
    removeStatusEffect(demon, expiredStatus);
    const effect = statusEffects[expiredStatus];
    if (effect) {
      statusMessages.push(`${effect.emoji} ${effect.name} has worn off from ${demonName}!`);
    }
  }

  // Update the status effects array
  demon.statusEffects = demon.statusEffects.filter(status => status.turnsRemaining > 0);

  // Send all status messages as one message if possible
  if (statusMessages.length > 0) {
    await message.channel.send(statusMessages.join('\n'));
  }
}

// Handle applying an ailment or buff from a skill
async function applyStatusFromSkill(attacker, target, move, message) {
  let statusApplied = false;
  const statusEffects = await dataManager.getStatusEffects();

  // Check for ailment application
  if (move.ailment) {
    // Skip if target already has this status
    if (await hasStatusEffect(target, move.ailment)) {
      const targetName = target.userId ? `<@${target.userId}> (${target.name})` : target.name;
      await message.channel.send(`${targetName} is already affected by ${statusEffects[move.ailment]?.name || move.ailment}!`);
    } else {
      // Check for complete immunity first
      if (target.resistances?.ailmentNull?.includes(move.ailment)) {
        const targetName = target.userId ? `<@${target.userId}> (${target.name})` : target.name;
        await message.channel.send(`${targetName} is immune to ${statusEffects[move.ailment]?.name || move.ailment}!`);
      } else {
        // Calculate chance based on stats
        const effect = await dataManager.getStatusEffect(move.ailment);
        const resistStat = effect?.resistStat || 'vitality';
        let baseChance = move.ailmentChance || effect?.chance || 40;

        // Adjust chance based on target's resistance stat vs attacker's magic/strength
        const attackStat = move.usesMagic ? attacker.magic : attacker.strength;
        const resistValue = target[resistStat] || 10;
        const statRatio = attackStat / resistValue;

        // Modify chance based on stat ratio with diminishing returns
        baseChance *= Math.min(1.5, Math.sqrt(statRatio));

        // Check for resistance and reduce chance if applicable
        if (target.resistances?.ailmentResist?.includes(move.ailment)) {
          baseChance *= 0.5; // 50% reduction in success chance
        }

        // Roll for application
        const roll = Math.random() * 100;
        if (roll <= baseChance) {
          const result = await addStatusEffect(target, move.ailment, attacker.name);

          if (result.success) {
            const targetName = target.userId ? `<@${target.userId}> (${target.name})` : target.name;
            const effect = await dataManager.getStatusEffect(move.ailment);
            await message.channel.send(`${targetName} is afflicted with ${effect.emoji || ''} ${effect.name || move.ailment}!`);
            statusApplied = true;
          } else {
            if (result.reason === 'immune') {
              const targetName = target.userId ? `<@${target.userId}> (${target.name})` : target.name;
              await message.channel.send(`${targetName} is immune to ${statusEffects[move.ailment].name || move.ailment}!`);
            } else if (result.reason === 'already_afflicted') {
              const targetName = target.userId ? `<@${target.userId}> (${target.name})` : target.name;
              await message.channel.send(`${targetName} is already afflicted with another ailment!`);
            }
          }
        } else {
          const targetName = target.userId ? `<@${target.userId}> (${target.name})` : target.name;
          await message.channel.send(`${targetName} resisted the ${statusEffects[move.ailment]?.name || move.ailment} effect!`);
        }
      }
    }
  }

  // Check for buff application
  if (move.buff) {
    const result = await addStatusEffect(attacker, move.buff, attacker.name);

    if (result.success) {
      const effect = await dataManager.getStatusEffect(move.buff);
      const attackerName = attacker.userId ? `<@${attacker.userId}> (${attacker.name})` : attacker.name;

      if (result.stacked) {
        await message.channel.send(`${effect.emoji || ''} ${effect.name || move.buff} on ${attackerName} is strengthened! (×${result.status.stacks})`);
      } else if (result.refreshed) {
        await message.channel.send(`${effect.emoji || ''} ${effect.name || move.buff} on ${attackerName} is extended!`);
      } else {
        await message.channel.send(`${attackerName} gains ${effect.emoji || ''} ${effect.name || move.buff}!`);
      }
      statusApplied = true;
    }
  }

  // Check for debuff application
  if (move.debuff) {
    const result = await addStatusEffect(target, move.debuff, attacker.name);

    if (result.success) {
      const effect = await dataManager.getStatusEffect(move.debuff);
      const targetName = target.userId ? `<@${target.userId}> (${target.name})` : target.name;

      if (result.stacked) {
        await message.channel.send(`${effect.emoji || ''} ${effect.name || move.debuff} on ${targetName} is strengthened! (×${result.status.stacks})`);
      } else if (result.refreshed) {
        await message.channel.send(`${effect.emoji || ''} ${effect.name || move.debuff} on ${targetName} is extended!`);
      } else {
        await message.channel.send(`${targetName} suffers from ${effect.emoji || ''} ${effect.name || move.debuff}!`);
      }
      statusApplied = true;
    }
  }

  return statusApplied;
}

// Check for instakill success
async function checkInstakill(attacker, target, move, message) {
  if (!move.instakill) return false;

  // Base chance - very low
  let baseChance = 15;

  // Adjust chance based on level difference
  const levelDiff = attacker.level - target.level;
  if (levelDiff > 0) {
    baseChance += Math.min(20, levelDiff * 2); // Up to +20% for level advantage
  } else {
    baseChance = Math.max(5, baseChance + levelDiff); // Down to 5% minimum
  }

  // Adjust for light/dark resistance
  if (move.type === 'Light' &&
    (target.resistances?.resist?.includes('Light') ||
      target.resistances?.null?.includes('Light') ||
      target.resistances?.repel?.includes('Light') ||
      target.resistances?.drain?.includes('Light'))) {
    return false;
  }

  if (move.type === 'Dark' &&
    (target.resistances?.resist?.includes('Dark') ||
      target.resistances?.null?.includes('Dark') ||
      target.resistances?.repel?.includes('Dark') ||
      target.resistances?.drain?.includes('Dark'))) {
    return false;
  }

  // Roll for instakill
  const roll = Math.random() * 100;
  if (roll <= baseChance) {
    target.hp = 0; // Instant death
    const targetName = target.userId ? `<@${target.userId}> (${target.name})` : target.name;
    await message.channel.send(`${move.emoji} ${move.name} instantly defeats ${targetName}!`);
    return true;
  }

  return false;
}

// Get effective multipliers from all active status effects
async function getStatusMultipliers(demon) {
  const multipliers = {
    strengthMultiplier: 1.0,
    magicMultiplier: 1.0,
    defenseMultiplier: 1.0,
    accuracyMultiplier: 1.0,
    evasionMultiplier: 1.0,
    physicalVulnerability: 1.0,
    magicalVulnerability: 1.0
  };

  if (!demon.statusEffects || demon.statusEffects.length === 0) {
    return multipliers;
  }

  const statusEffects = await dataManager.getStatusEffects();

  // Combine all multipliers from active status effects
  for (const status of demon.statusEffects) {
    const effect = statusEffects[status.name];
    if (!effect?.battleEffect) continue;

    Object.keys(effect.battleEffect).forEach(key => {
      if (multipliers[key] !== undefined) {
        // For buff stacking, multiply rather than replace
        multipliers[key] *= effect.battleEffect[key];
      }
    });
  }

  return multipliers;
}

// Handle breaking status effects when hit
async function handleStatusBreakOnDamage(demon, damageType = null) {
  if (!demon.statusEffects || demon.statusEffects.length === 0) return false;

  let effectsRemoved = [];
  const statusEffects = await dataManager.getStatusEffects();

  // Check each status effect for break conditions
  demon.statusEffects = demon.statusEffects.filter(status => {
    const effect = statusEffects[status.name];
    // Break on any damage
    if (effect?.breakOnDamage) {
      effectsRemoved.push(status.name);
      return false;
    }

    // Break on specific damage type
    if (effect?.weakTo && effect.weakTo === damageType) {
      effectsRemoved.push(status.name);
      return false;
    }

    return true;
  });

  return effectsRemoved;
}

// Export all functions
module.exports = {
  hasStatusEffect,
  getStatusEffect,
  addStatusEffect,
  removeStatusEffect,
  processStatusEffectsStart,
  processStatusEffectsEnd,
  applyStatusFromSkill,
  checkInstakill,
  getStatusMultipliers,
  handleStatusBreakOnDamage
};