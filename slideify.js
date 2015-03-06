var fs = require('fs');

var slides = fs.readFileSync('./slides.html');
var title = 'CSS - Et programmerings-teoretisk skråblikk';

document.querySelector('.slides').innerHTML = slides;
document.querySelector('title').text = title;
