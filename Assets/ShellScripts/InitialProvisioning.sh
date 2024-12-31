screen -d -m sh -c "sh </dev/console >/dev/console 2>&1;read";

TERM="xterm-256color";

stty sane;

#/etc/init.d/S99welcome
