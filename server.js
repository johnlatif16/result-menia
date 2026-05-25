const express = require("express");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const axios = require("axios");
const path = require("path");

const app = express();

const SECRET = "MY_SECRET_KEY";

app.use(cors());
app.use(express.json());
app.use(express.static("public"));


// LOGIN

app.post("/login",(req,res)=>{

  const {username,password} = req.body;

  if(username === "admin" && password === "123456"){

    const token = jwt.sign(
      {username},
      SECRET,
      {expiresIn:"1d"}
    );

    return res.json({token});

  }

  res.status(401).json({
    message:"Invalid credentials"
  });

});


// JWT MIDDLEWARE

function verifyToken(req,res,next){

  const bearer = req.headers["authorization"];

  if(!bearer){
    return res.sendStatus(403);
  }

  const token = bearer.split(" ")[1];

  jwt.verify(token,SECRET,(err,data)=>{

    if(err) return res.sendStatus(403);

    req.user = data;

    next();

  });

}


// PROTECTED ROUTE

app.get("/dashboard",verifyToken,(req,res)=>{
  res.json({
    success:true
  });
});


// RESULT API

app.get("/api/result/:seat", async(req,res)=>{

  try{

    const seat = req.params.seat;

    const response = await axios.get(
      `http://www.natega4dk.net/menia/?type=num&k=${seat}`
    );

    res.json({
      result:response.data
    });

  }catch(err){

    res.status(500).json({
      result:"حدث خطأ"
    });

  }

});


const PORT = process.env.PORT || 3000;

app.listen(PORT,()=>{
  console.log("Server Running");
});