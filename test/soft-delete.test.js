import cds from '@sap/cds'

const { GET, POST, PATCH, DELETE, expect } = cds.test('.')

const SRV = '/odata/v4/support'
const DB  = 'clouddna.support.Incidents'
const id  = n => `aaaaaaaa-0000-0000-0000-00000000000${n}`

/** Read straight from the table, bypassing the service and its filters. */
const rowInDatabase = ID => SELECT.one.from(DB).where({ ID })

describe('soft-delete: runtime', () => {

  it('hides the row from OData but keeps it in the database', async () => {
    const ID = id(1)
    const { status } = await DELETE(`${SRV}/Incidents(${ID})`)
    expect(status).to.equal(204)

    await expect(GET(`${SRV}/Incidents(${ID})`)).to.be.rejectedWith(/404/)

    const row = await rowInDatabase(ID)
    expect(row, 'row must still exist in the table').to.exist
    expect(row.deletedAt, 'deletedAt must be set').to.not.be.null
  })

  it('records who deleted the row', async () => {
    const ID = id(2)
    await DELETE(`${SRV}/Incidents(${ID})`)
    const row = await rowInDatabase(ID)
    expect(row.deletedBy).to.equal('anonymous')   // mocked auth, no user passed
  })

  it('answers 404 when the row is already soft-deleted', async () => {
    const ID = id(3)
    await DELETE(`${SRV}/Incidents(${ID})`)
    await expect(DELETE(`${SRV}/Incidents(${ID})`)).to.be.rejectedWith(/404/)
  })

  it('brings a row back with restore()', async () => {
    const ID = id(4)
    await DELETE(`${SRV}/Incidents(${ID})`)
    const { status } = await POST(`${SRV}/Incidents(${ID})/SupportService.restore`)
    expect(status).to.equal(204)

    const { data } = await GET(`${SRV}/Incidents(${ID})`)
    expect(data.ID).to.equal(ID)
    expect((await rowInDatabase(ID)).deletedAt).to.be.null
  })

  it('rejects restore() on a row that is not deleted', async () => {
    const ID = id(6)   // never deleted by any test, so it is live here
    await expect(POST(`${SRV}/Incidents(${ID})/SupportService.restore`)).to.be.rejectedWith(/404/)
  })

  it('does not leak soft-deleted rows through $expand', async () => {
    const ID = id(5)
    const { data: before } = await GET(`${SRV}/Customers?$expand=incidents($select=ID)`)
    expect(before.value.flatMap(c => c.incidents).map(i => i.ID)).to.include(ID)

    await DELETE(`${SRV}/Incidents(${ID})`)

    const { data: after } = await GET(`${SRV}/Customers?$expand=incidents($select=ID)`)
    expect(after.value.flatMap(c => c.incidents).map(i => i.ID)).to.not.include(ID)
  })

  it('ignores direct writes to deletedAt, because it is @readonly', async () => {
    const ID = id(6)
    const { data } = await PATCH(`${SRV}/Incidents(${ID})`, { deletedAt: '2020-01-01T00:00:00Z' })
    expect(data.deletedAt ?? null).to.be.null
    expect((await rowInDatabase(ID)).deletedAt).to.be.null
  })

  it('leaves entities without @softDelete on hard delete', async () => {
    const ID = '55555555-5555-5555-5555-555555555555'
    await DELETE(`${SRV}/Customers(${ID})`)
    expect(await SELECT.one.from('clouddna.support.Customers').where({ ID })).to.be.undefined
  })
})
