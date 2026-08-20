import cds from '@sap/cds'
import { expect } from 'chai'

// The model layer needs no server at all — just compile and look at the CSN.
describe('soft-delete: model layer', () => {

  let csn
  beforeAll(async () => { await cds.plugins; csn = await cds.load('*') })

  it('adds deletedAt/deletedBy to the annotated entity', () => {
    const { elements } = csn.definitions['clouddna.support.Incidents']
    expect(elements).to.have.property('deletedAt')
    expect(elements).to.have.property('deletedBy')
  })

  it('marks them @readonly so they cannot be written directly', () => {
    const { elements } = csn.definitions['clouddna.support.Incidents']
    expect(elements.deletedAt['@readonly']).to.be.true
    expect(elements.deletedBy['@readonly']).to.be.true
  })

  it('propagates the annotation and the elements into the service projection', () => {
    const projection = csn.definitions['SupportService.Incidents']
    expect(projection['@softDelete']).to.be.true
    expect(projection.elements).to.have.property('deletedAt')
  })

  it('injects the restore() action, which CDS does not propagate on its own', () => {
    expect(csn.definitions['clouddna.support.Incidents'].actions).to.have.property('restore')
    expect(csn.definitions['SupportService.Incidents'].actions).to.have.property('restore')
  })

  it('leaves entities without the annotation untouched', () => {
    const { elements } = csn.definitions['SupportService.Customers']
    expect(elements).to.not.have.property('deletedAt')
    expect(csn.definitions['SupportService.Customers'].actions ?? {}).to.not.have.property('restore')
  })
})
