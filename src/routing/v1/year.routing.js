const yearCTRL = require("../../controller/year.controller");

const yearRoute=require('express').Router();

yearRoute.post('/uploadyear', yearCTRL.upload_year);
yearRoute.get('/getyear', yearCTRL.get_year);
yearRoute.get('/getyear/:id', yearCTRL.get_year);
yearRoute.patch('/updateyear/:id', yearCTRL.upload_year);
yearRoute.delete('/deleteyear/:id', yearCTRL.delete_year);
yearRoute.post('/seed-nepali-year', yearCTRL.seed_nepali_year);
yearRoute.get('/options', yearCTRL.get_year_options);

module.exports=yearRoute;