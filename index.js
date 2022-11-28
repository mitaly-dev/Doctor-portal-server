const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require("stripe")('sk_test_51M6CE4BMtIhTvUhsjjwowd0TVare61yEtFADEVCRP3q3DxrbgtOI2XNnvvFeGsal680QelErzCop5KDlbIoNQfHr002idxqSLh');

var jwt = require('jsonwebtoken');
const cors = require('cors');
const { query } = require('express');
require('dotenv').config();
const app = express();
const port = process.env.PORT || 5000 


app.use(cors())
app.use(express.json())


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.ojtfupc.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

   
    const verifyJWT=(req,res,next)=>{
        const authHeader = req.headers.authorization 
        if(!authHeader){
        return res.status(401).send({message:'Unauthorized user'})
        }
        const token = authHeader.split(' ')[1]
        jwt.verify(token,process.env.SECRET_TOKEN,function(error,decoded){
            if(error){
                return res.status(403).send({message:'forbidden user'})
            }
            req.decoded = decoded
            next()
        })
    }


async function run(){
    try{
        const appointmentOptionsCollection = client.db('DoctorsPortal').collection('appointmentOptions')
        const bookingCollection = client.db('DoctorsPortal').collection('booking')
        const usersCollection = client.db('DoctorsPortal').collection('users')
        const doctorsCollection = client.db('DoctorsPortal').collection('doctors')
        const paymentsCollection = client.db('DoctorsPortal').collection('payments')

        const verifyAdmin =async (req,res,next)=>{
            const email = req.decoded.email
            const query = {email:email}
            const user = await usersCollection.findOne(query)
            if(user?.role!=='admin'){
                return res.status(403).send({message:'forbidden access'})
            }
             next()
        }

        app.post('/create-payment-intent',async(req,res)=>{
            const booking = req.body 
            const price = booking.price
            const amount = price*100
            console.log(booking)
            const paymentIntent = await stripe.paymentIntents.create({
                currency:'usd',
                amount:amount,
                "payment_method_types": [
                    "card"
                  ],
            })
            res.send({
                clientSecret: paymentIntent.client_secret,
              });
        })


        app.post('/payments',async(req,res)=>{
            const payment = req.body 
            const paymentResult = await paymentsCollection.insertOne(payment)
            const id = payment.bookingId 
            const filter = {_id : ObjectId(id)}
            const updateDoc = {
                $set : {
                    paid : true ,
                    transactionId : payment.transactionId
                }
            }
            const result = await bookingCollection.updateOne(filter,updateDoc)
            res.send(result)
        })

        app.get('/jwt',async(req,res)=>{
            const email = req.query.email
            const query = {email:email}
            const user = await usersCollection.findOne(query)
            if(user){
                const token = jwt.sign({email:email},process.env.SECRET_TOKEN,{expiresIn:'5h'})
                res.send({accessToken:token})
            }
            else{
                res.status(401).send({accessToken:''})
            }
        })

        app.get('/users',verifyJWT,async(req,res)=>{
            const result = await usersCollection.find({}).toArray()
            res.send(result)
        })

        app.get('/users/admin/:email',async(req,res)=>{
            const email = req.params.email
            const query = {email:email}
            const user = await usersCollection.findOne(query)
            res.send({isAdmin : user?.role === 'admin'})
           
        })


        app.post('/users',async(req,res)=>{
           const user = req.body 
           const result = await usersCollection.insertOne(user)
           res.send(result)
        })

        app.put('/users/admin/:id',verifyJWT,verifyAdmin,async(req,res)=>{
            const id = req.params.id 
            const filter = {_id:ObjectId(id)}
            const options = { upsert: true }
            const updateDoc={
                $set:{
                    role:'admin'
                }
            }
            const result = await usersCollection.updateOne(filter,updateDoc,options)
            res.send(result)
        })

        app.delete('/users/:id',async(req,res)=>{
            const id = req.params.id
            const email = req.query.email
            const user = await usersCollection.findOne({email:email})
            if(user.role!=='admin'){
                return res.status(401).send({message:"user not accessable"})
            }
            const query = {_id:ObjectId(id)}
            const result = await usersCollection.deleteOne(query)
            res.send(result)
        })

        app.get('/appointmentOptions',async(req,res)=>{
            const date = req.query.date
            const query = {}
            const bookingQuery = {appointmentDate:date}

            const alreadyBook = await bookingCollection.find(bookingQuery).toArray()
            const options = await appointmentOptionsCollection.find(query).toArray()

            options.forEach(option=>{
                const optionBooked = alreadyBook.filter(book=>book.treatement===option.name)
                const bookSlot = optionBooked.map(book=>book.slot)
                const remainingSlot = option.slots.filter(slot=>!bookSlot.includes(slot))
                option.slots=remainingSlot
            })

            res.send(options)
           
        })

        app.post('/booking',async(req,res)=>{
            const bookingData = req.body 
            const qury ={
                email:bookingData.email,
                appointmentDate:bookingData.appointmentDate,
                treatement:bookingData.treatement
            }
            const booking = await bookingCollection.find(qury).toArray()
            if(booking.length){
                return res.send({message:`you already have a booking on ${bookingData.appointmentDate}`})
            }
            const result = await bookingCollection.insertOne(bookingData)
            res.send(result)
        })

        app.get('/booking',verifyJWT,async(req,res)=>{
            const decodedEmail = req.decoded.email
            const email = req.query.email
            if(decodedEmail!==email){
              return  res.status(403).send({message:'unauthorized user'})
            }
            
            const query = {email:email}
            const result = await bookingCollection.find(query).toArray()
            res.send(result)
        })

        app.get('/booking/:id',async(req,res)=>{
            const id = req.params.id 
            const query = {_id:ObjectId(id)}
            const result = await bookingCollection.findOne(query)
            res.send(result)
        })

        app.get('/specialty',async(req,res)=>{
            const result = await appointmentOptionsCollection.find({}).project({name:1}).toArray()
            res.send(result)
        })

        app.post('/doctors',verifyJWT,verifyAdmin,async(req,res)=>{
            const doctor = req.body
            const result = await doctorsCollection.insertOne(doctor)
            res.send(result)
        })

        app.get('/doctors',verifyJWT,verifyAdmin,async(req,res)=>{
            const result = await doctorsCollection.find({}).toArray()
            res.send(result)
        })

        app.delete('/doctors/:id',verifyJWT,verifyAdmin,async(req,res)=>{
            const id = req.params.id
            const query = {_id:ObjectId(id)}
            const result = await doctorsCollection.deleteOne(query)
            res.send(result)
        })

        // app.get('/addedprice',async(req,res)=>{
        //     const filter = {}
        //     const options = {upsert:true}
        //     const updateDoc = {
        //         $set:{
        //             price:99
        //         }
        //     }
        //     const result = await appointmentOptionsCollection.updateMany(filter,updateDoc,options)
        //     res.send(result)
        //     console.log(result)
        // })

       
    }
    finally{

    }
}
run().catch(error=>console.error(error.message))



app.listen(port,()=>{
    console.log(`Doctor Portal is running on ${port}`)
})