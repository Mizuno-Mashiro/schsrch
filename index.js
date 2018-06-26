const express = require.main.require('express')
const path = require('path')
const os = require('os')
const PaperUtils = require('./view/paperutils')
const CIESubjects = require('./view/CIESubjects.js')
const sspdf = require('./lib/sspdf')
const fs = require('fs')
const cheerio = require('cheerio')
const crypto = require('crypto')
const assert = require('assert')
const postJsonReceiver = require('./lib/post-json-receiver.js')
require('./dist-server/serverrender')
const serverRender = global.serverRender
global.serverRender = null
const mongoose = require.main.require('mongoose')
const state2meta = require('./view/state2meta.js')
const Recognizer = require('./lib/recognizer.js')
const ParseQuery = require('./lib/parseQuery.js')

let indexPath = path.join(__dirname, 'dist/index.html')
let indexHtml = fs.readFileSync(indexPath)
if (process.env.NODE_ENV !== 'production') {
  fs.watch(indexPath, list => {
    fs.readFile(indexPath, { encoding: 'utf8' }, (err, data) => {
      if (err) {
        console.error(err)
        process.exit(1)
      } else {
        indexHtml = data
      }
    })
  })
}

module.exports = ({mongodb: db, elasticsearch: es}) => {
  let rMain = express.Router()

  require('./lib/dbModel.js')(db, es).then(({PastPaperDoc, PastPaperIndex, PastPaperFeedback, PastPaperRequestRecord, PastPaperCollection, PastPaperId}) => {
    function statusInfo () {
      return Promise.all([PastPaperDoc.count({}), PastPaperIndex.count({}), PastPaperRequestRecord.count({})])
        .then(([docCount, indexCount, requestCount]) => {
          return Promise.resolve({docCount, indexCount, requestCount})
        }, err => Promise.reject(err))
    }

    rMain.use(function (req, res, next) {
      if (req.hostname.match(/^www\./)) {
        res.redirect('https://schsrch.xyz' + req.path)
      } else {
        let org
        if ((org = req.get('Origin'))) {
          if (/^https:\/\/[a-zA-Z0-9_\-]+\.schsrch\.xyz$/.test(org)) {
            res.set('Access-Control-Allow-Origin', org)
          }
        }
        next()
      }
    })
    function saveRecord (rec) {
      return rec.save().then(() => {}, err => console.log('Error saving record: ' + err))
    }

    function renderView (state, res, postProcess) {
      res.type('html')
      let $ = cheerio.load(indexHtml)
      // We want this to be static so that service worker don't end up caching old data, and that's why no status.
      $('.react-root').html(serverRender(state))
      if (postProcess) {
        postProcess($, $('.react-root'))
      }
      let metas = state2meta(state)
      if (metas) {
        let headStyle = $('head style:last-child')
        if (metas.url) {
          let mt = $('<meta property="og:url">')
          mt.attr('content', metas.url)
          headStyle.before(mt)
        }
        if (metas.title) {
          let tit = $('<title></title>')
          tit.text(metas.title)
          headStyle.before(tit)

          let mt = $('<meta property="og:title">')
          mt.attr('content', metas.title)
          headStyle.before(mt)
        }
        if (metas.description) {
          let mt = $('<meta property="og:description">')
          mt.attr('content', metas.description)
          headStyle.before(mt)

          let mt2 = $('<meta name="description">')
          mt2.attr('content', metas.description)
          headStyle.before(mt2)
        }
        if (metas.noindex) {
          headStyle.before($('<meta name="robots" content="noindex">'))
        }
      }
      res.send($.html())
    }

    rMain.get('/', function (req, res) {
      renderView({}, res)
      let rec = new PastPaperRequestRecord({ip: req.ip, time: Date.now(), requestType: '/'})
      saveRecord(rec)
    })
    rMain.use('/resources', express.static(path.join(__dirname, 'dist')))
    rMain.use('/resources/pdfjs', express.static(path.join(__dirname, 'node_modules/pdfjs-dist/build')))
    rMain.get('/sw.js', function (req, res) {
      res.set('cache-control', 'max-age=0')
      res.sendFile(path.join(__dirname, 'dist/sw.js'))
    })
    rMain.get('/opensearch.xml', function (req, res) {
      res.set('cache-control', 'max-age=0')
      res.set()
      res.sendFile(path.join(__dirname, 'view/opensearch.xml'), {
        headers: {
          'content-type': 'application/opensearchdescription+xml'
        }
      })
    })

    rMain.get('/status/', function (req, res, next) {
      statusInfo().then(rst => res.send(rst), err => next(err))
    })

    let doSearch = require('./lib/doSearch.js')({PastPaperDoc, PastPaperIndex, PastPaperFeedback, PastPaperRequestRecord})

    rMain.get('/search/', function (req, res, next) {
      let query = (req.query.query || '').toString().trim()
      let format = req.query.as || 'json'
      if (query === '' && format === 'page') {
        res.redirect('/')
        return
      }
      let rec = new PastPaperRequestRecord({ip: req.ip, time: Date.now(), requestType: '/search/', search: query, format})
      saveRecord(rec)
      if (format === 'raw') {
        let queryParse = ParseQuery(query)
        if (!queryParse) {
          res.status(400)
          res.send("Can't perform text search with raw format.")
          return
        }
        let mongoFinder = queryParse.finder
        let wLinks = req.query.wlinks === '1' || req.query.wlinks === 'true'
        let wLinksOnly = req.query.wlinks === 'only'
        let dataStream = PastPaperDoc.find(mongoFinder, {subject: true, time: true, paper: true, variant: true, type: true}).cursor({
          transform: (!wLinksOnly
                        ? (doc => `${PaperUtils.setToString(doc)}_${doc.type}${wLinks ? `\thttps://${req.hostname}/doc/${doc._id}/` : ''}`)
                        : (doc => `https://${req.hostname}/doc/${doc._id}/`))
        })
        let ended = false
        res.type('text')
        dataStream.on('data', line => {
          if (ended) return
          res.write(line, 'utf-8')
          res.write('\n')
        })
        dataStream.on('error', err => {
          if (ended) return
          res.end(`-- Error orroured: ${err}`)
          dataStream.close()
          ended = true
        })
        dataStream.on('end', () => {
          if (ended) return
          res.end()
          dataStream.close()
          ended = true
        })
        res.on('close', () => {
          if (ended) return
          dataStream.close()
          ended = true
        })
        return
      }
      doSearch(query).then(rst => {
        if (format === 'json') {
          res.send(rst)
        } else if (format === 'page') {
          let querying = {query, error: null, result: JSON.parse(JSON.stringify(rst))}
          renderView({querying}, res, ($, reactRoot) => { reactRoot.attr('data-querying', JSON.stringify(querying)) })
        } else {
          res.status(404)
          res.send('Format unknow.')
        }
      }, err => {
        res.status(500)
        next(err)
      })
    })
    rMain.get('/disclaim/', function (req, res, next) {
      renderView({view: 'disclaim'}, res)
    })
    rMain.get('/help/', function (req, res, next) {
      renderView({view: 'home', showHelp: true}, res)
    })

    rMain.get('/doc/:id', function (req, res, next) {
      let docId = req.params.id.toString()
      let format = req.query.as || 'blob'
      let page = parseInt(req.query.page || 'NaN')
      if (!Number.isSafeInteger(page)) page = null
      PastPaperDoc.findOne({_id: docId}).then(doc => {
        let rec = new PastPaperRequestRecord({ip: req.ip, time: Date.now(), requestType: '/doc/', targetId: req.params.id, targetPage: page, targetFormat: format})
        saveRecord(rec)
        if (!doc || (page !== null && (page < 0 || page >= doc.numPages))) {
          next()
          return
        }
        if (format === 'blob') {
          if (page !== null) {
            next()
            return
          }
          let fname = `${PaperUtils.setToString(doc)}_${doc.type}.${doc.fileType}`
          doc.getFileBlob().then(blob => {
            res.set('Content-Disposition', `inline; filename=${JSON.stringify(fname)}`)
            res.type(doc.fileType)
            res.send(blob)
          }, err => {
            next(err)
          })
        } else if (format === 'sspdf') {
          if (page === null) {
            next()
            return
          }
          processSSPDF(doc, page).then(sspdf => {
            res.set('Cache-Control', 'max-age=' + (10 * 24 * 60 * 60 - 1).toString())
            res.send(sspdf)
          }, err => next(err))
        } else if (format === 'dir') {
          doc.ensureDir().then(dir => {
            if (page === null) {
              res.send(dir)
            } else {
              res.send(Recognizer.dirFilterPage(dir, page))
            }
          }, err => next(err))
        } else {
          res.status(404)
          res.send('Format unknow.')
        }
      }).catch(err => next(err))
    })

    rMain.get('/dirs/batch/', function (req, res, next) {
      if (!req.query.docid) return next()
      let docid = req.query.docid.toString().trim()
      let flattenEr = req.query.flattenEr === 'true'
      PastPaperDoc.findOne({_id: docid}).then(initDoc => {
        if (!initDoc) {
          next()
          return
        }
        if (!Number.isSafeInteger(initDoc.paper) && !Number.isSafeInteger(initDoc.variant)) {
          let obj = {}
          initDoc.ensureDir().then(dir => {
            obj[initDoc.type] = dir
            obj[initDoc.type].docid = initDoc._id.toString()
            res.send(obj)
          }, err => next(err))
        } else {
          PastPaperDoc.find({$or: [
            PaperUtils.extractSet(initDoc),
            {
              subject: initDoc.subject,
              time: initDoc.time,
              paper: 0,
              variant: 0
            }
          ]}).then(docs => Promise.all(docs.map(doc => {
            return doc.ensureDir().then(dir => Promise.resolve({type: doc.type, dir, docid: doc._id.toString()}))
          }))).then(tds => {
            let obj = {}
            for (let td of tds) {
              if (td.type !== 'er' || !flattenEr || td.dir.type !== 'er') {
                obj[td.type] = td.dir
              } else {
                let target = td.dir.papers.find(x => x.pv === `${initDoc.paper}${initDoc.variant}`)
                if (!target) {
                  obj[td.type] = {type: 'questions', dirs: []}
                } else {
                  obj[td.type] = {
                    type: 'er-flattened',
                    dirs: target.dirs
                  }
                }
              }
              obj[td.type].docid = td.docid
            }
            res.send(obj)
          }).catch(err => next(err))
        }
      }, err => next(err))
    })

    // TODO: record these requests.

    function requireAuthentication (req, res, next) {
      let authHeader = req.get('Authorization')
      let tokenMatch
      if (!authHeader) {
        res.status(401)
        res.send('Need login.')
        return
      }
      authHeader = authHeader.toString()
      if (!(tokenMatch = authHeader.match(/^Bearer\s+([0-9a-f]+)$/))) {
        res.status(400)
        res.send('Authorization header invalid.')
        return
      }
      let token = Buffer.from(tokenMatch[1], 'hex')
      PastPaperAuthSession.findOne({authToken: token, valid: true}, {authToken: false}).then(session => {
        if (!session) {
          res.status(401)
          res.send('Authorization token invalid.')
        } else {
          PastPaperId.findOne({_id: session.userId}).then(user => {
            if (!user) {
              res.status(401)
              res.send('Authorization token invalid.')
              return
            }
            req.authId = user
            req.authSession = session
            next()
          }, err => next(err))
        }
      }, err => next(err))
    }

    function optionalAuthentication (req, res, next) {
      if (req.get('Authorization')) {
        requireAuthentication(req, res, next)
      } else {
        req.authId = null
        next()
      }
    }

    rMain.get('/auth/', requireAuthentication, function (req, res, next) {
      res.send(req.authId)
    })

    rMain.head('/auth/:username', function (req, res, next) {
      let username = req.params.username.toString().trim()
      PastPaperId.count({username}).then(ct => {
        if (ct === 0) {
          res.status(404)
          res.end()
        } else {
          res.status(200)
          res.end()
        }
      })
    })
    rMain.post('/auth/:username/', function (req, res, next) {
      let username = req.params.username.toString().trim()
      if (!/^[^\s]{1,}$/.test(username)) {
        res.status(400)
        res.send('Username invalid. Must not contain space.')
        return
      }
      PastPaperId.findOne({username}, {_id: true}).then(existingId => {
        if (existingId) {
          res.status(400)
          res.send(`Username ${username} already existed.`)
          return
        }
        postJsonReceiver(req, res, next, parsed => {
          let token = null
          if (parsed.authToken) {
            try {
              let hex = parsed.authToken
              if (!/^[0-9a-f]{32}$/.test(hex)) {
                throw new Error('token must be a hex string of 16 bytes')
              }
              token = Buffer.from(hex, 'hex')
            } catch (e) {
              res.status(400)
              res.send(e.message)
              return
            }
          }
          let newId = new PastPaperId({
            username,
            creationTime: Date.now()
          })
          newId.save().then(() => PastPaperAuthSession.newSession(newId._id, req.ip, token)).then(token => {
            res.send({authToken: token.toString('hex'), userId: newId._id.toString()})
          }, err => next(err))
        })
      }, err => next(err))
    })

    rMain.post('/auths/challenges/replace/', requireAuthentication, function (req, res, next) {
      postJsonReceiver(req, res, next, parsed => {
        req.authId.granterReplace(parsed).then(() => {
          PastPaperAuthSession.update({userId: req.authId._id, _id: {$ne: req.authSession._id}}, {$set: {valid: false}}, {multi: true}).then(() => {
            res.status(200)
            res.end()
          }, err => {
            console.error(err)
            next(err)
            PastPaperAuthSession.remove({userId: req.authId._id, _id: {$ne: req.authSession._id}}).catch(err => console.error(err))
          })
        }, err => {
          res.status(400)
          res.send(err.message)
        })
      })
    })

    rMain.post('/auth/:username/newSession/', function (req, res, next) {
      postJsonReceiver(req, res, next, parsed => {
        let challenge = parsed
        let username = req.params.username
        if (typeof username !== 'string' || typeof challenge !== 'object') {
          res.status(400)
          res.send('Invalid payload.')
          return
        }
        PastPaperId.findOne({username}, {_id: true}).then(user => {
          if (!user) {
            res.status(404)
            res.send('User not find')
            return
          }
          PastPaperSessionGranter.verify(user._id, challenge).then(() => {
            PastPaperAuthSession.newSession(user._id, req.ip).then(token => {
              res.send({authToken: token.toString('hex')})
            }, err => next(err))
          }, err => {
            res.status(403)
            res.send(err.message)
          })
        })
      })
    })

    rMain.delete('/auths/session/', requireAuthentication, function (req, res, next) {
      PastPaperAuthSession.update({_id: req.authSession._id}, {$set: {valid: false}}, {multi: false}).then(() => {
        res.status(200)
        res.end()
      }, err => next(err))
    })

    rMain.post('/collections/new', requireAuthentication, function (req, res, next) {
      let now = Date.now()
      let cl = new PastPaperCollection({
        creationTime: now,
        ownerModifyTime: now,
        content: {},
        owner: req.authId._id
      })
      cl.save().then(() => {
        res.send({id: cl._id.toString()})
      }, err => {
        res.send({error: err.message})
      })
    })

    rMain.get('/collection/:collectionId/view/', function (req, res, next) {
      let { collectionId } = req.params
      renderView({view: 'collection', collection: {id: collectionId, loading: true}}, res)
    })

    rMain.get('/collection/:collectionId/content/', optionalAuthentication, function (req, res, next) {
      let collectionId = req.params.collectionId.toString()
      PastPaperCollection.findOne({_id: collectionId}).then(doc => {
        if (!doc) {
          next()
          return
        }
        let allowedRead = false
        if (req.authId && req.authId._id.equals(doc.owner)) {
          allowedRead = true
        } else if (doc.publicRead) {
          allowedRead = true
        } else if (req.authId && doc.allowedRead.find(x => req.authId._id.equals(x))) {
          allowedRead = true
        }
        if (allowedRead) {
          res.type('json')
          res.send(doc.content)
        } else {
          res.status(401)
          res.send('Access denied.')
        }
      }, err => {
        next(err)
      })
    })

    rMain.put('/collection/:collectionId/content/', requireAuthentication, function (req, res, next) {
      let collectionId = req.params.collectionId.toString()
      PastPaperCollection.findOne({_id: collectionId}).then(collectionDoc => {
        if (!collectionDoc) {
          next()
          return
        }
        postJsonReceiver(req, res, next, parsed => {
          let allowEdit = false
          if (req.authId._id.equals(collectionDoc.owner)) {
            allowEdit = true
            collectionDoc.ownerModifyTime = Date.now()
          } else if (collectionDoc.allowedWrite.find(x => req.authId._id.equals(x))) {
            allowEdit = true
          }
          if (allowEdit) {
            try {
              assert.notDeepEqual(collectionDoc.content, parsed)
              function assertKeyNameNoDollar (obj) {
                if (typeof obj === 'object') {
                  for (let k in obj) {
                    if (k.indexOf('$') >= 0) throw new Error('No $ in key name allowed.')
                    assertKeyNameNoDollar(obj[k])
                  }
                }
              }
              assertKeyNameNoDollar(parsed)
              collectionDoc.content = parsed
              collectionDoc.save().then(() => {
                res.status(200)
                res.end()
              }, err => {
                res.status(403)
                res.send(err.message)
              })
            } catch (e) {
              if (e.code === 'ERR_ASSERTION') {
                res.status(200)
                res.end()
              } else {
                next(e)
              }
            }
          } else {
            res.status(401)
            res.send("Access denied.")
          }
        })
      }, err => {
        next(err)
      })
    })

    rMain.delete('/collection/:id', requireAuthentication, function (req, res, next) {
      let id = req.params.id.toString()
      PastPaperCollection.findOne({_id: id}, {_id: true, owner: true}).then(col => {
        if (!col) {
          next()
          return
        }
        if (col.owner.equals(req.authId._id)) {
          PastPaperCollection.remove({_id: col._id}).then(() => {
            res.status(200)
            res.end()
          }, err => next(err))
        } else {
          res.status(401)
          res.send("Access denied.")
        }
      }, err => next(err))
    })

    rMain.get('/collections/by/:user/', optionalAuthentication, function (req, res, next) {
      let userId = req.params.user.toString()
      let limit = parseInt(req.query.limit)
      let skip = parseInt(req.query.skip)
      if (!Number.isSafeInteger(limit)) limit = 20
      if (!Number.isSafeInteger(skip)) skip = 0
      PastPaperId.findOne({_id: userId}).then(user => {
        if (!user) {
          next()
          return
        }
        let selector
        if (req.authId && req.authId._id.equals(user._id)) {
          selector = {
            owner: user._id
          }
        } else {
          let selectorOrs = [ {publicRead: true} ]
          if (req.authId) {
            selectorOrs.push({
              allowedRead: {
                $elemMatch: {$eq: req.authId._id}
              }
            })
            selectorOrs.push({
              allowedWrite: {
                $elemMatch: {$eq: req.authId._id}
              }
            })
          }
          selector = {
            $and: [
              {
                owner: user._id
              },
              {
                $or: selectorOrs
              }
            ]
          }
        }
        PastPaperCollection.count(selector).then(count => {
          if (count === 0) {
            res.send({count: 0, list: []})
          } else {
            PastPaperCollection.find(selector, {_id: true, creationTime: true, ownerModifyTime: true, content: true, owner: true, publicRead: true}).sort({ownerModifyTime: -1}).skip(skip).limit(limit).then(list => {
              res.send({count, list: list.map(x => Object.assign(x, { // Only return short content
                content: (x.content ? {
                  name: x.content.name || null,
                  firstP: (x.content.structure && x.content.structure[0] && x.content.structure[0].type === 'text') ? x.content.structure[0].html : ''
                } : {
                  name: '',
                  firstP: ''
                })
              }))})
            }, err => next(err))
          }
        }, err => next(err))
      }, err => next(err))
    })

    function processSSPDF (doc, pn) {
      return new Promise((resolve, reject) => {
        function postCache (stuff) {
          let result = stuff
          result.doc = doc
          result.doc.fileBlob = null
          result.doc.dir = null
          return result
        }

        PastPaperIndex.find({docId: doc._id, page: pn}).then(ppIdxes => {
          if (!ppIdxes || ppIdxes.length < 1) {
            reject(null)
            return
          }
          let ppIdx = ppIdxes[0]
          // FIXME: Race condition result in duplicate works
          if (ppIdx.sspdfCache) {
            resolve(postCache(ppIdx.sspdfCache))
          } else {
            console.log(`Building sspdf for ${doc._id}::${pn} (idx//${ppIdx._id})`)
            doc.getFileBlob().then(buff => {
              sspdf.getPage(buff, pn, function (err, result) {
                if (err) {
                  reject(err)
                } else {
                  sspdf.preCache(result, nResult => {
                    ppIdx.sspdfCache = nResult
                    result = null
                    ppIdx.save(err => {
                      if (err) {
                        console.error('Unable to save sspdfCache: ' + err)
                      }
                      resolve(postCache(nResult))
                    })
                  })
                }
              })
            })
          }
        }).catch(reject)
      })
    }

    rMain.post('/feedback/', function (req, res, next) {
      let ctype = req.get('Content-Type')
      let done = false
      if (ctype !== 'application/json') {
        res.status(415)
        res.send('Content type incorrect.')
        done = true
        return
      }
      let body = ''
      req.setEncoding('utf8')
      req.on('data', chunk => {
        if (done) return
        body += chunk
      })
      req.on('end', () => {
        if (done) return
        done = true
        body = body.trim()
        if (body.length === 0) {
          res.status(403)
          res.send('Content is empty.')
          return
        }
        let parsed = null
        try {
          parsed = JSON.parse(body)
          if (typeof parsed !== 'object') {
            throw new Error()
          }
          if (parsed.email === null) {
            parsed.email = ''
          }
        } catch (e) {
          res.status(403)
          res.send('Content is not valid JSON.')
          return
        }
        if (typeof parsed.email !== 'string' || typeof parsed.text !== 'string' || (parsed.search && typeof parsed.search !== 'string')) {
          res.status(403)
          res.send('JSON is malformed.')
          return
        }
        let fb = new PastPaperFeedback({
          time: Date.now(),
          ip: req.ip,
          email: parsed.email,
          text: parsed.text,
          search: parsed.search
        })
        fb.save().then(() => {
          res.status(200)
          res.end()
        }, err => {
          res.status(403)
          res.send(err.toString())
        })
      })
    })

    rMain.get('/subjects/', function (req, res, next) {
      function response (agg) {
        if (!req.query.as || req.query.as === 'page') {
          renderView({view: 'subjects', subjectStatistics: {loading: false, error: null, result: agg}}, res, ($, reactRoot) => {reactRoot.attr('data-subject-stats', JSON.stringify(agg))})
        } else if (req.query.as === 'json') {
          res.send(agg)
        } else {
          res.status(404)
          res.send('Format unknow.')
        }
      }
      PastPaperDoc.aggregate([{$sort: {subject: 1}}, {$group: {_id: '$subject', totalPaper: {$sum: 1}}}]).then(agg => {
        Promise.all(agg.map(g => PastPaperDoc.aggregate([{$match: {subject: g._id}}, {$sort: {time: 1}}, {$group: {_id: '$time'}}]))).then(aggr => {
          let nagg = agg.map((g, i) => {
            let r = aggr[i]
            if (!r) return g
            r = r.map(x => ({subject: g._id, time: x._id, paper: 0, variant: 0})).sort(PaperUtils.funcSortSet).map(x => x.time)
            let cSubj = CIESubjects.findExactById(g._id)
            if (cSubj) {
              return Object.assign({}, g, {times: r, name: cSubj.name, level: cSubj.level})
            } else {
              return Object.assign({}, g, {times: r, name: null, level: null})
            }
          })
          response(nagg)
        }, err => {
          response(agg)
        })
      }, err => next(err))
    })

    rMain.get('/robots.txt', function (req, res) {
      if (req.hostname.match(/^beta\./)) {
        res.sendFile(path.join(__dirname, 'view/betaRobots.txt'))
      } else {
        res.type('txt')
        res.send('')
      }
    })
    rMain.get('/redbook', function (req, res) {
      res.redirect('https://static.maowtm.org/redbook.pdf')
    })
  }, err => {
    rMain.use(function (req, res, next) {
      next(err)
    })
    console.error(err)
  })

  return rMain
}
