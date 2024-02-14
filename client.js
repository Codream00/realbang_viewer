import JoyStick from './joy.js'
import * as THREE from 'https://unpkg.com/three?module';


// peer connection
var pc = null;

//sseionID
var sessionID = null;

// data channel
var dc = null, dcInterval = null;

let throttleTimeout = null;
let joyThrottleTimeout = null;

// control config
let lastTouchX = 0;
let lastTouchY = 0;
let isDragging = false;
let xDeg = 0;
let yDeg = 20;
let offset = new THREE.Vector3(2,0.5,-5)
let radius = 3;


//joy config
let joyX = 0;
let joyY = 0;
let tempVector = new THREE.Vector3();
let upVector = new THREE.Vector3(0, 1, 0);
let previousTimeStamp = null;
let model = null;

async function init(){
    new JoyStick('joyDiv', {}, function (stickData) {
        joyX = stickData.x;
        joyY = stickData.y;
    });
    
    model  = getModelName();

    const viewer = document.querySelector(".viewer");
    viewer.addEventListener("mousedown", () => (isDragging = true));
    viewer.addEventListener("mouseup", () => (isDragging = false));
    viewer.addEventListener("mousemove", handleMouseMove);
    viewer.addEventListener("touchstart", handleTouchStart);
    viewer.addEventListener("touchmove", handleTouchMove);
    viewer.addEventListener("touchend", () => (isDragging = false));
}

async function createPeerConnection() {
    const iceServers = await fetch(
        `http://27.119.34.53:3000/ice-servers`,
        {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
            },
        }
    ).then((response) => response.json());

    var config = {
        iceServers: iceServers,
    };


    pc = new RTCPeerConnection(config);
    pc.addTransceiver("video", { direction: "recvonly" });
    
    let iceCandidateBuffer = [];
    
    pc.onicecandidate = async ({ candidate }) => {
        if (candidate) {
            iceCandidateBuffer.push(candidate);
        }
    };

    pc.ontrack = (event) => {
        console.log("Received track:", event);
        let player = document.getElementById("player");
        player.onerror = (error) => {
            console.error("Error: ", error);
        };
        console.log(player)
        console.log(player.srcObject)
        player.srcObject = event.streams[0];
    };

    dc = pc.createDataChannel("camera");
    dc.onopen = (event) =>{
        animate();
    } 
    // dc.onmessage = (event) => {
    //     let data = JSON.parse(event.data);
    //     camInfoElement.textContent = event.data;
    // }


    const offerOptions = {
        offerToReceiveAudio: false,
        offerToReceiveVideo: true,
    };
    const offer = await pc.createOffer(offerOptions);

    await pc.setLocalDescription(offer);

    const answer = await fetch(
        `http://27.119.34.53:3000/offer?session_id=${sessionID}&model_name=${model}`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                sdp: pc.localDescription.sdp,
                type: pc.localDescription.type,
            }),
        }
    ).then((response) => response.json());
    
    await pc.setRemoteDescription(answer)
    
    iceCandidateBuffer.forEach(async (candidate) => {
        await sendIceCandidate(candidate, sessionID);
    });
}

async function sendIceCandidate(candidate, sessionID) {
    const json = JSON.stringify(candidate);
    console.log("Sending ICE candidate: ", json);
    await fetch(
        `http://27.119.34.53:3000/ice-candidate?session_id=${sessionID}`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: json,
        }
    );
}

async function start() {
    sessionID = Math.random().toString(36).substring(2, 15);

    await createPeerConnection();
}

function animate(timeStamp) { //position move
    const angle = THREE.MathUtils.degToRad(-yDeg)

    if(previousTimeStamp && (joyX != 0|| joyY !=0)){
        var frameTime = timeStamp - previousTimeStamp;

        if(joyX != 0|| joyY !=0){
            tempVector.set(parseFloat(joyX),0,parseFloat(joyY)).applyAxisAngle(upVector, angle);
            offset.addScaledVector(
                tempVector,
                frameTime * 0.00004
            );
        }
    }

    const position = offset.toArray();
    const rotation = [-xDeg, -yDeg, 0];
    throttle(()=>{
        sendCameraInfoToBackend(position, rotation);
    },1000/30)
    requestAnimationFrame( animate );
    previousTimeStamp = timeStamp;
}

function stop() {
    // close data channel
    if (dc) {
        dc.close();
    }

    // close transceivers
    if (pc.getTransceivers) {
        pc.getTransceivers().forEach(function(transceiver) {
            if (transceiver.stop) {
                transceiver.stop();
            }
        });
    }

    // close local audio / video
    pc.getSenders().forEach(function(sender) {
        sender.track.stop();
    });

    // close peer connection
    setTimeout(function() {
        pc.close();
    }, 500);
}

function throttle(func, delay) {
    if (throttleTimeout) {
        return;
    }
    throttleTimeout = setTimeout(() => {
        func();
        throttleTimeout = null;
    }, delay);
}

function updateCamera(moveX, moveY) {
    yDeg -= moveX * 0.5;
    xDeg += moveY * 0.5;

    xDeg = Math.min(Math.max(xDeg, 0), 70);
    yDeg = (yDeg + 360) % 360;

    // const position = computePosition(xDeg, yDeg);
    const position = offset.toArray();
    const rotation = [-xDeg, -yDeg, 0];

    throttle(() => {
        sendCameraInfoToBackend(position, rotation);
    }, 1000 / 30);
}

function computePosition(xDeg, yDeg) {
    const theta = (xDeg * Math.PI) / 180;
    const phi = (yDeg * Math.PI) / 180;

    const position = [
        radius * Math.cos(phi) * Math.cos(theta) + offset[0],
        -radius * Math.sin(theta) + offset[1],
        radius * Math.sin(phi) * Math.cos(theta) + offset[2],
    ];

    return position;
}

function sendCameraInfoToBackend(position, rotation) {
    const payload = {
        type: "camera_update",
        position,
        rotation,
    };

    dc.send(JSON.stringify(payload));
}

function handleTouchStart(event) {
    event.preventDefault();
    isDragging = true;
    const touch = event.touches[0];
    lastTouchX = touch.clientX;
    lastTouchY = touch.clientY;
}

function handleTouchMove(event) {
    event.preventDefault();
    if (!isDragging) return;
    const touch = event.touches[0];
    const moveX = touch.clientX - lastTouchX;
    const moveY = touch.clientY - lastTouchY;

    lastTouchX = touch.clientX;
    lastTouchY = touch.clientY;

    updateCamera(moveX, moveY);
}

function handleMouseMove(event) {
    console.log("touch")
    if (!isDragging) return;
    const moveX =
        event.movementX || event.mozMovementX || event.webkitMovementX || 0;
    const moveY =
        event.movementY || event.mozMovementY || event.webkitMovementY || 0;

    updateCamera(moveX, moveY);
}

function getModelName() {
    let model = new URLSearchParams(location.search).get('model')
    if(!model) model = 'kangmin3'
    console.log(`model: ${model}`)
    return model
}

window.onload = () => {
    init();
}

export {start}

