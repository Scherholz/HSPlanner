import { describe, expect, it } from 'vitest'
import { getItemGrantedSkillByName, items, skills } from './index'

// Every "+N to <Skill>" bonus on an item must point at a skill the app knows,
// otherwise the engine silently ignores it while the tooltip still advertises it.
describe('item skillBonuses resolve to known skills', () => {
  it('every skillBonuses key is a class skill or an item-granted skill', () => {
    const classSkillNames = new Set(skills.map((s) => s.name))
    const unresolved: string[] = []
    for (const item of items) {
      for (const name of Object.keys(item.skillBonuses ?? {})) {
        if (classSkillNames.has(name)) continue
        if (getItemGrantedSkillByName(name)) continue
        unresolved.push(`${item.id}: ${name}`)
      }
    }
    expect(unresolved).toEqual([])
  })
})
