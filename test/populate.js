module.exports = populate

function populate (rawDB, duration) {
  var generators = []
  setTimeout(function clearGenerators () {
    generators.forEach(function clearGenerator (id) {
      clearInterval(id)
    })
    console.log('DONE')
    rawDB.createReadStream().on('data', function (data) {
      console.log(data)
    })
    generators = undefined
  }, duration)
  return function generate (db, generatorSettings) {
    generatorSettings.forEach(function (setting) {
      if (!generators) { return }
      generators.push(setInterval(GENERATE(setting.prefix), setting.interval))
    })
    function GENERATE (prefix) {
      return function () {
        var l = Math.floor(Math.random() * 2) + 1
        var key = prefix
        if(prefix[prefix.length-1] === '/') {
          for (var i = 0; i < l; i++) {
            key += String.fromCharCode(Math.random() * 26 + 97)
          }
        }
        var value = { n: Math.floor(Math.random() * 100) }
        // console.log(key, ' : ', value)
        db.put(key, value)
      }
    }
  }
}
