const supertest = require('supertest')
const should = require('should')

module.exports = schsrch =>
  describe('Basic pages', function () {
    it('200 for schsrch.xyz/', function (done) {
      supertest(schsrch)
        .get('/')
        .set('Host', 'schsrch.xyz')
        .expect('Content-Type', /html/)
        .expect(200)
        .end(done)
    })
    it('200 for beta.schsrch.xyz/', function (done) {
      supertest(schsrch)
        .get('/')
        .set('Host', 'beta.schsrch.xyz')
        .expect('Content-Type', /html/)
        .expect(200)
        .end(done)
    })
    it('beta.schsrch.xyz/robots.txt', function (done) {
      supertest(schsrch)
        .get('/robots.txt')
        .set('Host', 'beta.schsrch.xyz')
        .expect('Content-Type', /text\/plain/)
        .expect(200)
        .expect(res => res.text.should.match(/Disallow: \//))
        .end(done)
    })
    it('schsrch.xyz/robots.txt', function (done) {
      supertest(schsrch)
        .get('/robots.txt')
        .set('Host', 'schsrch.xyz')
        .expect('Content-Type', /text\/plain/)
        .expect(200)
        .expect(res => res.text.should.have.length(0))
        .end(done)
    })
    it('www.schsrch.xyz', function (done) {
      supertest(schsrch)
        .get('/whatever')
        .set('Host', 'www.schsrch.xyz')
        .expect(302)
        .expect('Location', 'https://schsrch.xyz/whatever')
        .end(done)
    })
    it('/status', function (done) {
      supertest(schsrch)
        .get('/status')
        .set('Host', 'schsrch.xyz')
        .expect(200)
        .expect(res => res.body.should.be.an.Object())
        .expect(res => res.body.docCount.should.be.a.Number())
        .expect(res => res.body.indexCount.should.be.a.Number())
        .expect(res => res.body.loadAvg.should.be.an.Array())
        .expect(res => res.body.loadAvg.should.have.length(3))
        .expect(res => res.body.loadAvg[0].should.be.a.Number())
        .end(done)
    })
    it('/sw.js', function (done) {
      supertest(schsrch)
        .get('/sw.js')
        .set('Host', 'schsrch.xyz')
        .expect(200)
        .expect('Content-Type', /javascript/)
        .expect(res => res.text.length.should.be.above(0))
        .end(done)
    })
    it('/disclaim/', function (done) {
      supertest(schsrch)
        .get('/disclaim/')
        .set('Host', 'schsrch.xyz')
        .expect(200)
        .expect('Content-Type', /html/)
        .expect(res => res.text.length.should.be.above(0))
        .end(done)
    })
    it('/formsearch', function (done) {
      const tQuery = `whateverqueryhere${Math.random()}`
      supertest(schsrch)
        .get('/formsearch/?query=' + encodeURIComponent(tQuery))
        .set('Host', 'schsrch.xyz')
        .expect(200)
        .expect('Content-Type', /html/)
        .expect(res => res.text.indexOf(`<input type="text" class="querybox border" value=${JSON.stringify(tQuery)} name="query" autocomplete="off"`).should.be.aboveOrEqual(0))
        .end(done)
    })
    it('/formsearch/(empty)', function (done) {
      supertest(schsrch)
        .get('/formsearch/?query=')
        .set('Host', 'schsrch.xyz')
        .expect(302)
        .expect('Location', '/')
        .end(done)
    })
    it('/formsearch/(space)', function (done) {
      supertest(schsrch)
        .get('/formsearch/?query=%20')
        .set('Host', 'schsrch.xyz')
        .expect(302)
        .expect('Location', '/')
        .end(done)
    })
  })
