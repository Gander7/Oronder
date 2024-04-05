import {item_roll, Logger} from "./util.mjs";
import {socket} from "./module.mjs";
import {COMBAT_ENABLED, COMBAT_HOOKS, COMBAT_HEALTH_ESTIMATE, ID_MAP, MODULE_ID} from "./constants.mjs";
import { actor_to_discord_ids } from "./sync.mjs";

const onCombatStart = async (combat, updateData) =>  {
    const roundRender = parseCombatRound({ ...combat, ...updateData })
    const turnRender = parseTurn(combat, updateData) 
    socket.emit('combat', roundRender+turnRender)
}
const onCombatTurn = async (combat, updateData, updateOptions) => {
    if (updateOptions.direction < 1) return
    const turnRender = parseTurn(combat, updateData) 
    socket.emit('combat', turnRender)
}
const onCombatRound = async (combat, updateData, updateOptions) => {
    if (updateOptions.direction < 1) return
    const roundRender = parseCombatRound({ ...combat, ...updateData }, updateOptions)
    const turnRender = parseTurn(combat, updateData) 
    socket.emit('combat', roundRender+turnRender)
}

export function set_combat_hooks() {
    Logger.info("Setting Combat Hooks.")

    let combatHooks = game.settings.get(MODULE_ID, COMBAT_HOOKS)

    const turnOffHook = (key) => {
        if (combatHooks[key] > -1) {
            Hooks.off(key, combatHooks[key])
            combatHooks[key] = -1
        }
    }

    // Turn off hooks
    ["combatStart", "combatTurn", "combatRound"].forEach(key => turnOffHook(key))

    // Turn them back on
    if (game.settings.get(MODULE_ID, COMBAT_ENABLED))
    {
        combatHooks = {
            combatStart: Hooks.on("combatStart", onCombatStart),
            combatTurn: Hooks.on("combatTurn", onCombatTurn),
            combatRound: Hooks.on("combatRound", onCombatTurn)
        }
    }

    // update settings with function ids
    game.settings.set(MODULE_ID, COMBAT_HOOKS, combatHooks)
}

export function handle_incoming_rolls() {
    socket.on('roll', async data => {
        const actor = game.actors.find(a => a.id === data.actor_id)
        if (actor === undefined) {
            Logger.error('actor not found')
            return
        }

        const foundry_user_ids = Object.entries(game.settings.get(MODULE_ID, ID_MAP))
            .filter(([_, v]) => v === data.discord_id)
            .map(([k, _]) => k)

        const actor_owners = Object.entries(actor.ownership)
            .filter(([_, ownership_level]) => ownership_level === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)
            .map(([user_id, _]) => user_id)

        const user_id = foundry_user_ids.filter(
            user_id => actor_owners.includes(user_id)
        )[0] || game.userId

        switch (data['type']) {
            case 'stat':
                Logger.info(`stat roll`)
                Logger.info(data)
                break
            case 'attack':
                Logger.info(`attack roll`)
                //Actors who haven't been synced after 3/27/24 may only have reference to item name and not id
                const item_match_fun = data?.item_id ?
                    i => i.id === data.item_id :
                    i => i.name === data.item_name

                const item = actor.items.find(item_match_fun)

                if (item === undefined) {
                    Logger.error('item not found')
                    return
                }

                //TODO: we want to use the roll from discord, but for now just focusing on formatting
                const roll = item_roll(item)

                await roll.toMessage({
                    user: game.user.id,
                    rollMode: 'roll',
                    speaker: ChatMessage.getSpeaker({actor}),
                    content: await renderTemplate('systems/dnd5e/templates/chat/item-card.hbs', {
                        user: game.user,
                        actor,
                        item,
                        data: item.getRollData(),
                        hasAttack: item.hasAttack,
                        hasDamage: item.hasDamage,
                        isHealing: item.isHealing,
                        rollType: item.system.actionType || 'Attack',
                        fullContext: true
                    })
                })
                let template = await renderTemplate('systems/dnd5e/templates/chat/item-card.hbs', {
                    actor,
                    item
                })
                await roll.toMessage({
                    user: game.user.id,
                    rollMode: 'roll',
                    speaker: ChatMessage.getSpeaker({actor}),
                })


                const item_html = await renderTemplate(
                    'systems/dnd5e/templates/chat/item-card.hbs',
                    {actor, item}
                )
                const roll_html = await roll.render()

                await roll.toMessage({
                    speaker: ChatMessage.getSpeaker({actor}),
                    user: user_id,
                    content: [item_html, roll_html].join('\n')
                })

                await ChatMessage.create({
                    user: game.user.id,

                    // flavor: `${actor.name} attacks with ${itemName}!`,
                    rolls: [(await roll.roll()).toJSON()],
                    type: CONST.CHAT_MESSAGE_TYPES.ROLL
                })

                break
        }
    })
}