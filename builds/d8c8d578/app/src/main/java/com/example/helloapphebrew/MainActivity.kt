package com.example.helloapphebrew

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            Surface(
                modifier = Modifier.fillMaxSize(),
                color = MaterialTheme.colorScheme.background
            ) {
                HelloScreen()
            }
        }
    }
}

@Composable
fun HelloScreen() {
    var greetingMessage by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = "ברוכים הבאים",
            fontSize = 32.sp,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.primary
        )
        
        Spacer(modifier = Modifier.height(32.dp))
        
        Button(
            onClick = { 
                greetingMessage = "שלום! שמחים לראות אותך כאן."
            },
            modifier = Modifier.height(50.dp)
        ) {
            Text(
                text = "כפתור שלום",
                fontSize = 18.sp
            )
        }
        
        Spacer(modifier = Modifier.height(24.dp))
        
        if (greetingMessage.isNotEmpty()) {
            Text(
                text = greetingMessage,
                fontSize = 20.sp,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.secondary
            )
        }
    }
}
