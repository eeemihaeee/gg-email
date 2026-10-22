import { describe, expect, it } from 'vitest'
import {
  POLICY_DEFINITIONS,
  buildPolicyState,
  defaultPolicyValues,
  policyValue
} from '@shared/policy'

describe('политики', () => {
  it('содержит значения по умолчанию для всех определений', () => {
    const values = defaultPolicyValues()
    for (const definition of POLICY_DEFINITIONS) {
      expect(values).toHaveProperty(definition.key)
    }
    expect(values.blockRemoteContent).toBe(true)
    expect(values.updateMode).toBe('auto')
    expect(Array.isArray(values.blockedAttachmentExtensions)).toBe(true)
  })

  it('приводит значения реестра к типам', () => {
    const state = buildPolicyState(
      {
        updateMode: 'notify',
        UpdateCheckIntervalHours: '24',
        blockRemoteContent: '1',
        blockedAttachmentExtensions: 'exe, scr ,bat',
        googleClientId: 'abc.apps.googleusercontent.com'
      },
      'registry-machine'
    )
    expect(state.values.updateMode).toBe('notify')
    expect(state.values.updateCheckIntervalHours).toBe(24)
    expect(state.values.blockRemoteContent).toBe(true)
    expect(state.values.blockedAttachmentExtensions).toEqual(['exe', 'scr', 'bat'])
    expect(state.values.googleClientId).toBe('abc.apps.googleusercontent.com')
    expect(state.managed).toBe(true)
    expect(state.source).toBe('registry-machine')
    expect(state.locked).toContain('updateMode')
  })

  it('ограничивает числовые значения диапазоном', () => {
    const state = buildPolicyState({ updateCheckIntervalHours: 100000 }, 'file')
    expect(state.values.updateCheckIntervalHours).toBe(168)
    const low = buildPolicyState({ updateCheckIntervalHours: -5 }, 'file')
    expect(low.values.updateCheckIntervalHours).toBe(1)
  })

  it('отбрасывает некорректные значения и сообщает об ошибке', () => {
    const state = buildPolicyState({ updateMode: 'иногда', updateCheckIntervalHours: 'abc' }, 'file')
    expect(state.values.updateMode).toBe('auto')
    expect(state.locked).not.toContain('updateMode')
    expect(state.errors).toHaveLength(2)
    expect(state.managed).toBe(false)
  })

  it('policyValue возвращает значение или запасное', () => {
    const state = buildPolicyState({ updateMode: 'disabled' }, 'file')
    expect(policyValue(state, 'updateMode', 'auto')).toBe('disabled')
    expect(policyValue(state, 'logLevel', 'warn')).toBe('warn')
  })

  it('каждый enum содержит значение по умолчанию', () => {
    for (const definition of POLICY_DEFINITIONS) {
      if (definition.type === 'enum') {
        expect(definition.enum).toContain(definition.default)
      }
    }
  })
})
