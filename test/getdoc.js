const supertest = require('supertest')
const should = require('should')
const crypto = require('crypto')

module.exports = (schsrch, dbModel) =>
  describe('Getting the document', function () {
    const {PastPaperDoc, PastPaperIndex} = dbModel
    let simpleTestQP = null
    let simpleTestDF = null
    before(function (done) {
      PastPaperDoc.find({subject: '0610', time: 's17', paper: 1, variant: 1, type: 'qp'}).then(docs => {
        if (!docs || docs.length !== 1) {
          return void done(new Error(`There should be one 0610_s17_1_1_qp, and only one. Got ${docs ? docs.length : 0}.`))
        }
        simpleTestQP = docs[0]
        done()
      })
    })
    before(function (done) {
      PastPaperDoc.find({subject: '0417', time: 's18', paper: 1, variant: 0, type: 'df'}).then(docs => {
        if (!docs || docs.length !== 1) {
          return void done(new Error(`There should be one 0417_s18_1_0_df, and only one. Got ${docs ? docs.length : 0}.`))
        }
        simpleTestDF = docs[0]
        done()
      })
    })

    for (let withFormat of [false, true]) {
      it('/doc/' + (withFormat ? '?as=blob' : '') + ' (normal qp pdf)', function (done) {
        let tDoc = simpleTestQP
        let hash = crypto.createHash('sha256')
        supertest(schsrch)
          .get('/doc/' + encodeURIComponent(tDoc._id) + '/' + (withFormat ? '?as=blob' : ''))
          .expect(200)
          .expect('Content-Type', /pdf/)
          .expect(res => res.header['content-length'].should.be.above(0))
          .buffer()
          .parse((res, callback) => {
            res.on('data', chunk => {
              hash.write(chunk)
            })
            res.on('end', () => {
              hash.end()
              callback(null, null)
            })
          })
          .end(err => {
            if (err) {
              done(err)
              return
            }
            hash.on('readable', () => {
              try {
                hash.read().toString('hex').should.equal('00a2562f321e764b70a69fa4d374f8ac5aee20731e4a788f2ce4a898f41f262b') // sha256sum test/pastpapers/0610_s17_qp_11.pdf
                done()
              } catch (e) {
                done(e)
              }
            })
          })
      })
      it('/doc/' + (withFormat ? '?as=blob' : '') + ' (df blob)', function (done) {
        let tDoc = simpleTestDF
        let chunks = []
        supertest(schsrch)
          .get('/doc/' + encodeURIComponent(tDoc._id) + '/' + (withFormat ? '?as=blob' : ''))
          .expect(200)
          .expect('Content-Type', /octet-stream/)
          .expect(res => res.header['content-length'].should.be.above(0))
          .buffer()
          .parse((res, callback) => {
            res.on('data', chunk => {
              chunks.push(chunk)
            })
            res.on('end', () => {
              callback(null, null)
            })
          })
          .end(err => {
            if (err) {
              done(err)
              return
            }
            let bf = Buffer.concat(chunks)
            bf.toString('hex').should.equal('deadbeef')
            done()
          })
      })
    }

    it('/doc/ with 000000000000000000000000', function (done) {
      supertest(schsrch)
        .get('/doc/000000000000000000000000/?as=blob')
        .expect(404)
        .end(done)
    })
    it('/doc/ with 000000000000000000000000', function (done) {
      supertest(schsrch)
        .get('/doc/000000000000000000000000/?as=dir')
        .expect(404)
        .end(done)
    })
    let sspdfTestDoc = null
    function sspdfTestBody (done) {
      PastPaperDoc.find({subject: '0610', time: 's16', paper: 2, variant: 0}).then(docs => {
        if (!docs || docs.filter(x => x.type === 'qp').length !== 1) {
          done(new Error(`There should be one and only one 0610_s16_2_0_qp in the testing database (there are currently ${docs.length}).`))
          return
        }
        let tDoc = docs.filter(x => x.type === 'qp')[0]
        let tMsDoc = docs.filter(x => x.type === 'ms')[0]
        sspdfTestDoc = tDoc
        supertest(schsrch)
          .get('/doc/' + encodeURIComponent(tDoc._id) + '/?page=0&as=sspdf')
          .expect(200)
          .expect('Content-Type', /json/)
          .expect(res => res.body.should.be.an.Object())
          .expect(res => res.body.doc.should.be.an.Object())
          .expect(res => ['subject', 'time', 'paper', 'variant', 'type', 'numPages', 'fileType'].forEach(p => res.body.doc[p].should.equal(tDoc[p])))
          .expect(res => res.body.doc._id.should.equal(tDoc._id.toString()))
          .expect(res => ['width', 'height'].forEach(p => res.body[p].should.be.a.Number().and.above(0)))
          .expect(res => res.body.pageNum.should.equal(tDoc.numPages))
          .expect(res => should.not.exist(res.body.doc.doc))
          .expect(res => should.not.exist(res.body.doc.fileBlob))
          .expect(res => res.body.svg.should.be.a.String().and.match(/^<svg/))
          .end(testForMs)
        function testForMs (err) {
          if (err) {
            done(err)
            return
          }
          supertest(schsrch)
            .get('/doc/' + encodeURIComponent(tMsDoc._id) + '/?page=0&as=sspdf')
            .expect(200)
            .expect('Content-Type', /json/)
            .expect(res => res.body.should.be.an.Object())
            .expect(res => res.body.doc.should.be.an.Object())
            .expect(res => ['subject', 'time', 'paper', 'variant', 'type', 'numPages', 'fileType'].forEach(p => res.body.doc[p].should.equal(tMsDoc[p])))
            .expect(res => res.body.doc._id.should.equal(tMsDoc._id.toString()))
            .expect(res => ['width', 'height'].forEach(p => res.body[p].should.be.a.Number().and.above(0)))
            .expect(res => res.body.pageNum.should.equal(tMsDoc.numPages))
            .expect(res => should.not.exist(res.body.doc.doc))
            .expect(res => should.not.exist(res.body.doc.fileBlob))
            .expect(res => res.body.svg.should.be.a.String().and.match(/^<svg/))
            .end(done)
        }
      })
    }
    it('sspdf', sspdfTestBody)
    it('sspdf (second time on the same document)', sspdfTestBody)
    it('sspdf (third time on the same document)', sspdfTestBody)
    it('sspdf (multi-thread)', function (done) {
      Promise.all([1,1,1,1,1].map(x => new Promise((resolve, reject) => {
        sspdfTestBody(function (err) {
          console.log('    ' + (err ? 'x' : '✓'))
          if (err) {
            reject(err)
          } else {
            resolve()
          }
        })
      }))).then(() => done(), err => done(err))
    })
    function testPage404 (page, done) {
      page = parseInt(page)
      supertest(schsrch)
        .get('/doc/' + encodeURIComponent(sspdfTestDoc._id) + '/?as=sspdf&page=' + page)
        .expect(404)
        .end(done)
    }
    it('404 for sspdf with page -1', function (done) {
      testPage404(-1, done)
    })
    it('404 for sspdf with page 1 (out of range)', function (done) {
      testPage404(1, done)
    })
    it('400 for sspdf with page NaN', function (done) {
      supertest(schsrch)
        .get('/doc/' + encodeURIComponent(sspdfTestDoc._id) + '/?as=sspdf&page=NaN')
        .expect(400)
        .end(done)
    })
    it('400 for sspdf with no page number', function (done) {
      supertest(schsrch)
        .get('/doc/' + encodeURIComponent(sspdfTestDoc._id) + '/?as=sspdf')
        .expect(400)
        .end(done)
    })
    it('404 for 000000000000000000000000', function (done) {
      supertest(schsrch)
        .get('/doc/000000000000000000000000/?as=sspdf&page=0')
        .expect(404)
        .end(done)
    })
    it('404 for unknow format', function (done) {
      supertest(schsrch)
        .get(`/doc/${sspdfTestDoc._id}/?as=lol`)
        .expect(404)
        .expect(res => res.text.should.match(/format unknow/i))
        .end(done)
    })
    it('400 for blob with page', function (done) {
      supertest(schsrch)
        .get(`/doc/${sspdfTestDoc._id}/?as=blob&page=0`)
        .expect(400)
        .end(done)
    })
    it('sspdf preview should be cached', function (done) {
      PastPaperIndex.findOne({docId: sspdfTestDoc._id, page: 0}).then(idx => {
        if (!idx) {
          done(new Error('Index not exist.'))
          return
        }
        try {
          idx.sspdfCache.should.be.an.Object()
          idx.sspdfCache.svg.should.be.a.String().and.match(/^<svg/)
          idx.sspdfCache.rects.should.be.an.Array()
          idx.sspdfCache.rects.forEach(x => x.should.be.an.Object())
          done()
        } catch (e) {
          done(e)
        }
      })
    })
    it('should 404 if PastPaperIndex missing', function (done) {
      PastPaperIndex.remove({docId: sspdfTestDoc._id}).then(() => {
        testPage404(0, done)
      }, err => done(err))
    })

    it('sspdf for non-PDFs with page specified should 406', function (done) {
      supertest(schsrch)
        .get(`/doc/${encodeURIComponent(simpleTestDF._id.toString())}/?page=0&as=sspdf`)
        .expect(406)
        .end(done)
    })
    it('dir for non-PDFs with page specified should 406', function (done) {
      supertest(schsrch)
        .get(`/doc/${encodeURIComponent(simpleTestDF._id.toString())}/?page=0&as=dir`)
        .expect(406)
        .end(done)
    })
    it('sspdf for non-PDFs with page not specified should 406', function (done) {
      supertest(schsrch)
        .get(`/doc/${encodeURIComponent(simpleTestDF._id.toString())}/?as=sspdf`)
        .expect(406)
        .end(done)
    })
  })
