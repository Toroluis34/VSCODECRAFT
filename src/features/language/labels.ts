import * as vscode from 'vscode';

/** Localized human label for a registry ("item", "loot table", "sound event" ...). */
export function registryLabel(registry: string): string {
  switch (registry) {
    case 'item': return vscode.l10n.t('item');
    case 'block': return vscode.l10n.t('block');
    case 'fluid': return vscode.l10n.t('fluid');
    case 'entity_type': return vscode.l10n.t('entity type');
    case 'enchantment': return vscode.l10n.t('enchantment');
    case 'mob_effect': return vscode.l10n.t('effect');
    case 'potion': return vscode.l10n.t('potion');
    case 'attribute': return vscode.l10n.t('attribute');
    case 'sound_event': return vscode.l10n.t('sound event');
    case 'sound_file': return vscode.l10n.t('sound file');
    case 'particle_type': return vscode.l10n.t('particle');
    case 'loot_table': return vscode.l10n.t('loot table');
    case 'recipe': return vscode.l10n.t('recipe');
    case 'recipe_serializer': return vscode.l10n.t('recipe type');
    case 'advancement': return vscode.l10n.t('advancement');
    case 'function': return vscode.l10n.t('function');
    case 'predicate': return vscode.l10n.t('predicate');
    case 'item_modifier': return vscode.l10n.t('item modifier');
    case 'model': return vscode.l10n.t('model');
    case 'texture': return vscode.l10n.t('texture');
    case 'item_definition': return vscode.l10n.t('item model definition');
    case 'block_definition': return vscode.l10n.t('blockstate');
    case 'equipment': return vscode.l10n.t('equipment asset');
    case 'data_component_type': return vscode.l10n.t('data component');
    case 'loot_function_type': return vscode.l10n.t('loot function');
    case 'loot_condition_type': return vscode.l10n.t('loot condition');
    case 'loot_pool_entry_type': return vscode.l10n.t('loot entry type');
    case 'trigger_type': return vscode.l10n.t('advancement trigger');
    case 'damage_type': return vscode.l10n.t('damage type');
    case 'dimension': return vscode.l10n.t('dimension');
    case 'dimension_type': return vscode.l10n.t('dimension type');
    case 'worldgen/biome': return vscode.l10n.t('biome');
    case 'worldgen/structure': return vscode.l10n.t('structure');
    case 'structure': return vscode.l10n.t('structure template');
    case 'trim_material': return vscode.l10n.t('trim material');
    case 'trim_pattern': return vscode.l10n.t('trim pattern');
    case 'banner_pattern': return vscode.l10n.t('banner pattern');
    case 'jukebox_song': return vscode.l10n.t('jukebox song');
    case 'instrument': return vscode.l10n.t('instrument');
    case 'painting_variant': return vscode.l10n.t('painting variant');
    case 'enchantment_effect_component_type': return vscode.l10n.t('enchantment effect');
  }
  return registry.replace(/^worldgen\//, '').replace(/_/g, ' ');
}
