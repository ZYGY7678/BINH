package com.example.helloapphebrew

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
    var message by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = "אפליקציית בדיקה",
            fontSize = 28.sp,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.padding(bottom = 32.dp)
        )

        Button(
            onClick = { message = "שלום עולם!" },
            modifier = Modifier
                .height(56.dp)
                .width(200.dp)
        ) {
            Text(
                text = "שלום",
                fontSize = 20.sp
            )
        }

        if (message.isNotEmpty()) {
            Spacer(modifier = Modifier.height(32.dp))
            Text(
                text = message,
                fontSize = 24.sp,
                color = MaterialTheme.colorScheme.secondary
            )
        }
    }
}