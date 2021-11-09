//jshint esversion:6
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const ejs = require("ejs");
const mongoose = require("mongoose");
const session = require("express-session");
const passport = require("passport");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

//passport-local-mongoose depend on passport-local
const passportLocalMongoose = require("passport-local-mongoose");
const findOrCreate = require("mongoose-findorcreate");

var GoogleStrategy = require("passport-google-oauth20").Strategy;
const { addListener } = require("npm");

// const encrypt = require("mongoose-encryption");

const app = express();

app.use(express.static("public"));
app.set("view engine", "ejs");
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);

app.use(
  session({
    secret: process.env.SECRET,
    resave: false,
    saveUninitialized: true,
  })
);

app.use(passport.initialize());
app.use(passport.session());
const url = process.env.URL;
mongoose.connect(url, { useNewUrlParser: true, useUnifiedTopology: true });
mongoose.set("useCreateIndex", true);

const userSchema = new mongoose.Schema({
  username: String,
  password: String,
  googleId: String,
  emailId: String,
  resumename: [String],
  sharedresume: [String],
});

userSchema.plugin(passportLocalMongoose);
userSchema.plugin(findOrCreate);


const User = new mongoose.model("User", userSchema);

passport.use(User.createStrategy());

passport.serializeUser(function (user, done) {
  done(null, user.id);
});

passport.deserializeUser(function (id, done) {
  User.findById(id, function (err, user) {
    done(err, user);
  });
});

const callBackUrl =
  "http://localhost:3000/auth/google/resumeshare" ||
  "https://resume-share.herokuapp.com/auth/google/resumeshare";
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: callBackUrl,
    },
    function (accessToken, refreshToken, profile, cb) {
      // console.log(profile.emails[0].value);
      User.findOrCreate({ googleId: profile.id,emailId:profile.emails[0].value }, function (err, user) {
        return cb(err, user);
      });
    }
  )
);

app.get("/", function (req, res) {
  res.render("home");
});

app.get(
  "/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get(
  "/auth/google/resumeshare",
  passport.authenticate("google", { failureRedirect: "/login" }),
  function (req, res) {
    // Successful authentication, redirect secrets.
    res.redirect("/secrets");
  }
);

app.get("/register", function (req, res) {
  res.render("register", { regMessage: null });
});

app.get("/login", function (req, res) {
  res.render("login");
});

app.get("/secrets", function (req, res) {
  if (req.isAuthenticated()) {
    User.findById(req.user.id, function (err, foundUser) {
      if (err) {
        next(err);
      } else {
        if (foundUser) {
          res.render("secrets", { userWithResumes: foundUser.resumename });
        } else {
          res.redirect("/login");
        }
      }
    });
  } else {
    res.redirect("/login");
  }
});

app.get("/submit", function (req, res) {
  if (req.isAuthenticated()) {
    res.render("submit");
  } else {
    res.redirect("/login");
  }
});

app.get("/uploads/:resumeName",function(req,res){
  if (req.isAuthenticated()) {
    var requestedFile = req.params.resumeName;
   //check that user has file or not
    if(req.user.sharedresume.includes(requestedFile) || req.user.resumename.includes(requestedFile)){
      res.sendFile(__dirname + '/views/uploads/'+requestedFile);
    }else{
      res.redirect("/secrets");
    }
  }else{
    res.redirect("/login");
  }
  
});

app.get("/logout", function (req, res) {
  req.logout();
  req.session.destroy(function (err) {
    delete req.session;
    res.redirect("/");
  });
});

app.post("/register", function (req, res) {
  User.register(
    { username: req.body.username },
    req.body.password,
    function (err, user) {
      if (err) {
        res.render("register", { regMessage: err.message });
      } else {
        passport.authenticate("local")(req, res, function () {
          res.redirect("/secrets");
        });
      }
    }
  );
});

app.post("/login", function (req, res, next) {
  const user = new User({
    username: req.body.username,
    password: req.body.password,
  });
  passport.authenticate("local", function (err, user, info) {
    if (err) {
      return next(err);
    }
    if (!user) {
      return res.redirect("/login");
    }
    // req / res held in closure
    req.logIn(user, function (err) {
      if (err) {
        return next(err);
      }
      return res.redirect("/secrets");
    });
  })(req, res, next);
});

//middleware to store file in folder
var Storage = multer.diskStorage({
  destination: "./views/uploads",
  filename: (req, file, cb) => {
    cb(
      null,
      path.basename(file.originalname, ".pdf") +
        "_" +
        Date.now() +
        path.extname(file.originalname)
    );
  },
});
var upload = multer({
  storage: Storage,
}).single("file");

app.post("/submit", upload, function (req, res) {
  const submittedNewSecret = req.file.filename;
  // console.log(req.user.id);

  User.findById(req.user.id, function (err, foundUser) {
    if (err) {
      next(err);
    } else {
      if (foundUser) {
        foundUser.resumename.push(submittedNewSecret);
        foundUser.save(function () {
          res.redirect("/secrets");
        });
      }
    }
  });
});

app.post("/delete", function (req, res) {
  const indexOfItem = req.body.indexOfItem;
  const resumename = req.body.resumename;
  User.findById(req.user.id, function (err, foundUser) {
    if (err) {
      console.log(err);
    } else {
      if (foundUser) {
        //delete file from folder
        const pathToFile = "./views/uploads/"+resumename;

        fs.unlink(pathToFile, function(err) {
          if (err) {
            throw err
          } else {
          console.log("Successfully deleted the file.")

          }
        })
        //delter file name from datebase
        foundUser.resumename.splice(indexOfItem, 1);
        foundUser.save(function () {
          res.redirect("/secrets");
        });
      }
    }
  });
});

app.post("/sharewith", function (req, res) {
  const resumename = req.body.resumename;
  const sharewithemail = req.body.sharewithemail;
  // console.log(indexOfItem," ",sharewithemail);
  User.findOne({ 'emailId': sharewithemail }, 'sharedresume', function (err, user) {
    if (err) { 
      console.log(err)
    }else{
      if(user){
        user.sharedresume.push(resumename);
        user.save(function () {
        
          res.redirect("/secrets");
        });
      }else{
        res.send("user not found");
      }
    };
    
  });
});

app.listen(process.env.PORT || 3000, function () {
  console.log("server start at 3000");
});
