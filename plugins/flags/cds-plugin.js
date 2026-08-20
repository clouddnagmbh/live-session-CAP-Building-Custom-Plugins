import cds from '@sap/cds'
import flags from './flags.json' with { type: 'json' }

const LOG = cds.log('flags')
const isFlagified = element => element['@flagify']

LOG.debug(`flags available for ${Object.keys(flags).length} countries`)

cds.once('served', services => {
  for (const srv of services) {
    if (!(srv instanceof cds.ApplicationService)) continue
    for (const entity of srv.entities) {
      const targets = Object.values(entity.elements).filter(isFlagified)
      if (!targets.length) continue
      LOG.info('flagifying', `${entity.name}.{${targets.map(e => e.name)}}`)
      srv.after('READ', entity, rows => {
        for (const row of rows)
          for (const el of targets) row[el.name] = flags[row[el.name]] ?? row[el.name]
      })
    }
  }
})
